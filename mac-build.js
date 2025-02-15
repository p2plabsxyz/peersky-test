import { execSync } from "child_process";
import path from "path";

export default async function afterSign(context) {
  if (process.platform !== "darwin") {
    console.log("afterSign: Skipping quarantine removal on non-darwin platform.");
    return;
  }

  const appOutDir = context.appOutDir;
  const appName = context.packager.appInfo.productFilename;

  const appPath = path.join(appOutDir, `${appName}.app`);

  console.log(`Removing quarantine attribute from: ${appPath}`);
  execSync(`xattr -rd com.apple.quarantine "${appPath}"`);
};
