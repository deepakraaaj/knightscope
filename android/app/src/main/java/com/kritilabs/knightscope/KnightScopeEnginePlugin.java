package com.kritilabs.knightscope;

import android.util.Log;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStreamReader;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.Map;

/**
 * Native Stockfish as child processes. The engine executable is shipped as
 * jniLibs/&lt;abi&gt;/libstockfish.so (built by native/build-android-engine.sh) so the installer
 * extracts it to nativeLibraryDir, the one app-owned location Android still allows exec() from.
 *
 * Each engine instance is identified by a string id, so batch analysis can run several
 * single-threaded engines in parallel (fixed-depth searches are far more efficient that way than
 * one multi-threaded engine) while interactive features use their own instance.
 *
 * The plugin is a plain UCI line pipe: send() writes one line to an instance's stdin, and every
 * stdout line is emitted, in order, as a "line" event carrying { id, line }. No lines are
 * synthesised; the JS side owns all timeouts.
 */
@CapacitorPlugin(name = "KnightScopeEngine")
public class KnightScopeEnginePlugin extends Plugin {

    private static final String TAG = "KnightScopeEngine";
    private static final String ENGINE_FILE = "libstockfish.so";
    private static final String FALLBACK_NAME = "Stockfish (native)";
    private static final String DEFAULT_ID = "main";
    private static final int MAX_INSTANCES = 8;

    private static final class Instance {
        final Process process;
        final Writer stdin;
        final Thread reader;

        Instance(Process process, Writer stdin, Thread reader) {
            this.process = process;
            this.stdin = stdin;
            this.reader = reader;
        }
    }

    /** Guards the instance map. */
    private final Object lock = new Object();
    private final Map<String, Instance> instances = new HashMap<>();

    /** Result of the one-time probe handshake: null = not probed yet. */
    private static volatile String probedName;
    private static volatile Boolean probedOk;

    private File engineFile() {
        return new File(getContext().getApplicationInfo().nativeLibraryDir, ENGINE_FILE);
    }

    private static String idOf(PluginCall call) {
        String id = call.getString("id");
        return (id == null || id.isEmpty()) ? DEFAULT_ID : id;
    }

    @PluginMethod
    public void isAvailable(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("cores", Runtime.getRuntime().availableProcessors());
        File exe = engineFile();
        if (!exe.isFile() || !exe.canExecute()) {
            Log.w(TAG, "engine not executable: " + exe.getAbsolutePath());
            ret.put("available", false);
            call.resolve(ret);
            return;
        }
        if (probedOk == null) probe(exe);
        ret.put("available", probedOk);
        if (probedOk) ret.put("engineName", probedName);
        call.resolve(ret);
    }

    /** Spawns the engine once, sends "uci" and reads "id name" so we know it really runs here. */
    private static synchronized void probe(File exe) {
        if (probedOk != null) return;
        Process p = null;
        String name = null;
        boolean ok = false;
        try {
            p = new ProcessBuilder(exe.getAbsolutePath()).redirectErrorStream(true).start();
            Writer w = new OutputStreamWriter(p.getOutputStream(), StandardCharsets.UTF_8);
            w.write("uci\n");
            w.flush();
            BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8));
            final Process proc = p;
            // Safety net: never let a broken binary hang the plugin thread.
            Thread killer = new Thread(() -> {
                try {
                    Thread.sleep(5000);
                    proc.destroy();
                } catch (InterruptedException ignored) {}
            });
            killer.setDaemon(true);
            killer.start();
            String line;
            while ((line = r.readLine()) != null) {
                if (line.startsWith("id name ")) name = line.substring(8).trim();
                if (line.trim().equals("uciok")) {
                    ok = true;
                    break;
                }
            }
            killer.interrupt();
            try {
                w.write("quit\n");
                w.flush();
            } catch (IOException ignored) {}
        } catch (IOException e) {
            Log.e(TAG, "engine probe failed", e);
        } finally {
            if (p != null) {
                waitForExit(p, 500);
                p.destroy();
            }
        }
        probedName = (name == null || name.isEmpty()) ? FALLBACK_NAME : name;
        probedOk = ok;
        Log.i(TAG, "engine probe: ok=" + ok + " name=" + probedName);
    }

    /** Start (or restart) the instance with the given id. Other instances are not affected. */
    @PluginMethod
    public void start(PluginCall call) {
        final String id = idOf(call);
        File exe = engineFile();
        synchronized (lock) {
            stopLocked(id);
            if (instances.size() >= MAX_INSTANCES) {
                call.reject("Too many engine instances running");
                return;
            }
            try {
                final Process p = new ProcessBuilder(exe.getAbsolutePath())
                    .directory(getContext().getFilesDir())
                    .redirectErrorStream(true) // stderr merged, so a full stderr pipe can never block the engine
                    .start();
                Writer stdin = new OutputStreamWriter(p.getOutputStream(), StandardCharsets.UTF_8);
                Thread reader = new Thread(() -> pump(id, p), "stockfish-" + id);
                reader.setDaemon(true);
                instances.put(id, new Instance(p, stdin, reader));
                reader.start();
                Log.i(TAG, "engine started: id=" + id);
            } catch (IOException e) {
                Log.e(TAG, "engine start failed: id=" + id, e);
                call.reject("Failed to start engine: " + e.getMessage(), e);
                return;
            }
        }
        call.resolve();
    }

    /** Reader thread: one "line" event per stdout line of process p, until EOF or p is replaced. */
    private void pump(String id, Process p) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                synchronized (lock) {
                    Instance cur = instances.get(id);
                    if (cur == null || cur.process != p) break; // stale process after stop()/restart: drop its tail
                }
                JSObject data = new JSObject();
                data.put("id", id);
                data.put("line", line);
                notifyListeners("line", data);
            }
        } catch (IOException e) {
            // Stream closed by stop() or the process died; JS watchdogs handle the silence.
        }
        Log.i(TAG, "engine stdout closed: id=" + id);
    }

    @PluginMethod
    public void send(PluginCall call) {
        String command = call.getString("command");
        if (command == null) {
            call.reject("command is required");
            return;
        }
        String id = idOf(call);
        synchronized (lock) {
            Instance inst = instances.get(id);
            if (inst == null) {
                call.reject("Engine not running: " + id);
                return;
            }
            try {
                inst.stdin.write(command);
                inst.stdin.write('\n');
                inst.stdin.flush();
            } catch (IOException e) {
                call.reject("Engine write failed: " + e.getMessage(), e);
                return;
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        String id = idOf(call);
        synchronized (lock) {
            stopLocked(id);
        }
        call.resolve();
    }

    /** Idempotent: quit, give the engine a moment to exit, then kill it. Caller holds lock. */
    private void stopLocked(String id) {
        Instance inst = instances.remove(id);
        if (inst == null) return;
        try {
            inst.stdin.write("quit\n");
            inst.stdin.flush();
        } catch (IOException ignored) {}
        try {
            inst.stdin.close();
        } catch (IOException ignored) {}
        waitForExit(inst.process, 500);
        inst.process.destroy();
        inst.reader.interrupt();
        Log.i(TAG, "engine stopped: id=" + id);
    }

    /** Process.waitFor(timeout) needs API 26; minSdk is 24, so poll exitValue(). */
    private static void waitForExit(Process p, long timeoutMs) {
        long deadline = System.currentTimeMillis() + timeoutMs;
        while (System.currentTimeMillis() < deadline) {
            try {
                p.exitValue();
                return;
            } catch (IllegalThreadStateException running) {
                try {
                    Thread.sleep(20);
                } catch (InterruptedException e) {
                    Thread.currentThread().interrupt();
                    return;
                }
            }
        }
    }

    @Override
    protected void handleOnDestroy() {
        synchronized (lock) {
            for (String id : new ArrayList<>(instances.keySet())) stopLocked(id);
        }
        super.handleOnDestroy();
    }
}
