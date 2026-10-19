package com.jiaoshi.quiz;

import android.net.Uri;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * 检查更新的 Capacitor 桥：把 UpdateChecker 的能力暴露给 WebView 里的 JS。
 *
 * JS 侧（window.Capacitor.Plugins.UpdateChecker）：
 *   - checkUpdate()            -> { hasUpdate, current, tag, version, size, url, notes }
 *   - startDownload(url)       -> { fileName, downloadId }，进度通过 "progress" 事件推送
 *   - installApk(fileName)     -> { started }（false = 需要先去开「安装未知应用」权限）
 */
@CapacitorPlugin(name = "UpdateChecker")
public class UpdatePlugin extends Plugin {

    private static final int STATUS_SUCCESSFUL = 8; // DownloadManager.STATUS_SUCCESSFUL
    private static final int STATUS_FAILED = 16;    // DownloadManager.STATUS_FAILED

    @PluginMethod
    public void checkUpdate(final PluginCall call) {
        // 网络请求放到子线程，结果回主线程 resolve
        new Thread(() -> {
            try {
                UpdateChecker.ReleaseInfo info = UpdateChecker.fetchLatest();
                String current = UpdateChecker.currentVersion(getContext());
                JSObject ret = new JSObject();
                ret.put("hasUpdate", UpdateChecker.hasNewer(info.tag, current));
                ret.put("current", current);
                ret.put("tag", info.tag);
                ret.put("version", info.version());
                ret.put("size", info.apkSize);
                ret.put("url", info.apkUrl);
                ret.put("notes", info.notes == null ? "" : info.notes);
                // resolve 需要在主线程
                getActivity().runOnUiThread(() -> call.resolve(ret));
            } catch (Exception e) {
                getActivity().runOnUiThread(() ->
                        call.reject("检查更新失败：" + e.getMessage()));
            }
        }).start();
    }

    @PluginMethod
    public void startDownload(final PluginCall call) {
        String url = call.getString("url", "");
        if (url.isEmpty()) {
            call.reject("缺少 url 参数");
            return;
        }
        // 从 URL 里取文件名（GitHub Release 资产直接下载没有重定向尾巴）
        String fileName = Uri.parse(url).getLastPathSegment();
        if (fileName == null || fileName.isEmpty() || !fileName.toLowerCase().endsWith(".apk")) {
            fileName = "paopao-quiz-update.apk";
        }
        final String name = fileName;
        final long id = UpdateChecker.download(getContext(), url, name);
        if (id == -1) {
            call.reject("无法开始下载（DownloadManager 不可用）");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("fileName", name);
        ret.put("downloadId", id);
        call.resolve(ret);

        // 轮询下载进度，通过 "progress" / "finished" 事件推给 JS
        final AtomicBoolean running = new AtomicBoolean(true);
        new Thread(() -> {
            int lastPercent = -1;
            while (running.get()) {
                try {
                    Thread.sleep(800);
                } catch (InterruptedException e) {
                    return;
                }
                UpdateChecker.DownloadProgress p = UpdateChecker.queryDownload(getContext(), id);
                if (p == null) return; // 任务被清掉了，静默结束
                if (p.status == STATUS_SUCCESSFUL) {
                    JSObject done = new JSObject();
                    done.put("fileName", name);
                    done.put("downloadId", id);
                    notifyListeners("finished", done);
                    return;
                }
                if (p.status == STATUS_FAILED) {
                    JSObject fail = new JSObject();
                    fail.put("fileName", name);
                    fail.put("downloadId", id);
                    notifyListeners("failed", fail);
                    return;
                }
                if (p.total > 0) {
                    int percent = (int) (p.downloaded * 100 / p.total);
                    if (percent != lastPercent) {
                        lastPercent = percent;
                        JSObject prog = new JSObject();
                        prog.put("percent", percent);
                        prog.put("downloaded", p.downloaded);
                        prog.put("total", p.total);
                        notifyListeners("progress", prog);
                    }
                }
            }
        }).start();
    }

    @PluginMethod
    public void installApk(final PluginCall call) {
        String fileName = call.getString("fileName", "");
        if (fileName.isEmpty()) {
            call.reject("缺少 fileName 参数");
            return;
        }
        File apk = UpdateChecker.downloadedFile(getContext(), fileName);
        if (!apk.exists() || apk.length() == 0) {
            call.reject("更新包不存在或未下载完成");
            return;
        }
        boolean started = UpdateChecker.promptInstall(getActivity(), apk);
        JSObject ret = new JSObject();
        ret.put("started", started);
        call.resolve(ret);
    }

    /**
     * 列出已下载的更新包，附版本号与「是否已装完」标记：
     * installedOrOlder = 安装包版本 <= 当前安装版本（或解析失败），即已经装过/损坏，可提示删除；
     * 否则是下载了但还没装的，可以提示继续安装。
     */
    @PluginMethod
    public void listDownloadedUpdates(final PluginCall call) {
        File dir = UpdateChecker.updateDir(getContext());
        com.getcapacitor.JSArray arr = new com.getcapacitor.JSArray();
        String current = UpdateChecker.currentVersion(getContext());
        if (dir.exists() && dir.isDirectory()) {
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    if (!f.getName().toLowerCase().endsWith(".apk") || f.length() == 0) continue;
                    String ver = UpdateChecker.archiveVersion(getContext(), f);
                    JSObject item = new JSObject();
                    item.put("fileName", f.getName());
                    item.put("size", f.length());
                    item.put("version", ver == null ? "" : ver);
                    boolean installedOrOlder;
                    if (ver == null || ver.isEmpty()) {
                        installedOrOlder = true; // 解析失败 = 损坏文件，按可清理处理
                    } else {
                        installedOrOlder = UpdateChecker.compareVersions(
                                UpdateChecker.normalizeVersion(ver),
                                UpdateChecker.normalizeVersion(current)) <= 0;
                    }
                    item.put("installedOrOlder", installedOrOlder);
                    arr.put(item);
                }
            }
        }
        JSObject ret = new JSObject();
        ret.put("files", arr);
        call.resolve(ret);
    }

    /** 删除一个已下载的更新包 */
    @PluginMethod
    public void deleteUpdateFile(final PluginCall call) {
        String fileName = call.getString("fileName", "");
        if (fileName.isEmpty() || fileName.contains("/") || fileName.contains("..")) {
            call.reject("非法的文件名");
            return;
        }
        File apk = UpdateChecker.downloadedFile(getContext(), fileName);
        boolean deleted = apk.exists() && apk.delete();
        JSObject ret = new JSObject();
        ret.put("deleted", deleted);
        call.resolve(ret);
    }
}
