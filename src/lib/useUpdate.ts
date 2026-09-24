import { useCallback, useEffect, useState } from 'react';
import { RavenNative, isNative } from './native';
import { checkForUpdate, type UpdateInfo } from './update';

/** In-app updater: checks the preview release on launch and downloads/installs a newer APK. */
export function useUpdate() {
  const native = isNative();
  const [info, setInfo] = useState<UpdateInfo | null>(null);
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);

  const check = useCallback(async () => {
    if (!native) return;
    setChecking(true);
    try {
      const { versionCode } = await RavenNative.appInfo();
      setInfo(await checkForUpdate(versionCode));
    } catch {
      setInfo(null);
    } finally {
      setChecking(false);
    }
  }, [native]);

  useEffect(() => {
    void check();
  }, [check]);

  const install = useCallback(async () => {
    if (!info?.apkUrl) return;
    setInstalling(true);
    try {
      await RavenNative.downloadAndInstall({ url: info.apkUrl });
    } catch {
      // left to the UI: the button returns to its idle state so the user can retry
    } finally {
      setInstalling(false);
    }
  }, [info]);

  return { native, info, checking, installing, check, install };
}
