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

/**
 * Native Stockfish as a child process. The engine executable is shipped as
 * jniLibs/&lt;abi&gt;/libstockfish.so (built by native/build-android-engine.sh) so the installer
 * extracts it to nativeLibraryDir, the one app-owned location Android still allows exec() from.
 *
 * The plugin is a plain UCI line pipe: send() writes one line to stdin, every stdout line is
 * emitted, in order, as a "line" event. No lines are synthesised; the JS side owns all timeouts.
 */
@CapacitorPlugin(name = "KnightScopeEngine")
public class KnightScopeEnginePlugin extends Plugin {

    private static final String TAG = "KnightScopeEngine";
    private static final String ENGINE_FILE = "libstockfish.so";
    private static final String FALLBACK_NAME = "Stockfish (native)";

    /** Guards process / stdin / reader swaps. */
    private final Object lock = new Object();
    private Process process;
    private Writer stdin;
    private Thread reader;

    /** Result of the one-time probe handshake: null = not probed yet. */
    private static volatile String probedName;
    private static volatile Boolean probedOk;

    private File engineFile() {
        return new File(getContext().getApplicationInfo().nativeLibraryDir, ENGINE_FILE);
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

    @PluginMethod
    public void start(PluginCall call) {
        File exe = engineFile();
        synchronized (lock) {
            stopLocked();
            try {
                final Process p = new ProcessBuilder(exe.getAbsolutePath())
                    .directory(getContext().getFilesDir())
                    .redirectErrorStream(true) // stderr merged, so a full stderr pipe can never block the engine
                    .start();
                process = p;
                stdin = new OutputStreamWriter(p.getOutputStream(), StandardCharsets.UTF_8);
                reader = new Thread(() -> pump(p), "stockfish-stdout");
                reader.setDaemon(true);
                reader.start();
                Log.i(TAG, "engine started: " + exe.getAbsolutePath());
            } catch (IOException e) {
                process = null;
                stdin = null;
                reader = null;
                Log.e(TAG, "engine start failed", e);
                call.reject("Failed to start engine: " + e.getMessage(), e);
                return;
            }
        }
        call.resolve();
    }

    /** Reader thread: one "line" event per stdout line of process p, until EOF or p is replaced. */
    private void pump(Process p) {
        try (BufferedReader r = new BufferedReader(new InputStreamReader(p.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while ((line = r.readLine()) != null) {
                synchronized (lock) {
                    if (process != p) break; // stale process after stop()/restart: drop its tail
                }
                JSObject data = new JSObject();
                data.put("line", line);
                notifyListeners("line", data);
            }
        } catch (IOException e) {
            // Stream closed by stop() or the process died; JS watchdogs handle the silence.
        }
        Log.i(TAG, "engine stdout closed");
    }

    @PluginMethod
    public void send(PluginCall call) {
        String command = call.getString("command");
        if (command == null) {
            call.reject("command is required");
            return;
        }
        synchronized (lock) {
            if (process == null || stdin == null) {
                call.reject("Engine not running");
                return;
            }
            try {
                stdin.write(command);
                stdin.write('\n');
                stdin.flush();
            } catch (IOException e) {
                call.reject("Engine write failed: " + e.getMessage(), e);
                return;
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void stop(PluginCall call) {
        synchronized (lock) {
            stopLocked();
        }
        call.resolve();
    }

    /** Idempotent: quit, give the engine a moment to exit, then kill it. Caller holds lock. */
    private void stopLocked() {
        Process p = process;
        Writer w = stdin;
        Thread t = reader;
        process = null;
        stdin = null;
        reader = null;
        if (p == null) return;
        if (w != null) {
            try {
                w.write("quit\n");
                w.flush();
            } catch (IOException ignored) {}
            try {
                w.close();
            } catch (IOException ignored) {}
        }
        waitForExit(p, 500);
        p.destroy();
        if (t != null) t.interrupt();
        Log.i(TAG, "engine stopped");
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
            stopLocked();
        }
        super.handleOnDestroy();
    }
}
