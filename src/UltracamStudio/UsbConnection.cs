using System.Diagnostics;
namespace UltracamStudio;

public sealed record AndroidDevice(string Serial, string State) {
 public override string ToString() => $"{Serial} · {(State == "device" ? "autorisé" : State == "unauthorized" ? "autorisez ce PC sur le téléphone" : State)}";
}

/// <summary>Uses the user's Android platform-tools; never downloads or replaces ADB.</summary>
public sealed class UsbConnection {
 private readonly Func<string[], Task<string>> run;
 public UsbConnection(Func<string[], Task<string>>? runner = null) => run = runner ?? RunAsync;
 public static AndroidDevice[] ParseDevices(string output) => output.Split('\n')
  .Select(line => line.Trim().Split((char[]?)null, StringSplitOptions.RemoveEmptyEntries))
  .Where(parts => parts.Length >= 2 && parts[1] is "device" or "unauthorized" or "offline" or "recovery" or "sideload")
  .Select(parts => new AndroidDevice(parts[0], parts[1])).ToArray();
 public async Task<AndroidDevice[]> DevicesAsync() => ParseDevices(await run(["devices"]));
 public async Task ConnectAsync(AndroidDevice device) {
  if (device.State != "device") throw new InvalidOperationException("Déverrouillez le téléphone et autorisez le débogage USB pour ce PC, puis actualisez la liste.");
  await run(["-s", device.Serial, "reverse", $"tcp:{StreamServer.Port}", $"tcp:{StreamServer.Port}"]);
 }
 private static string AdbPath() {
  var candidates = new[] {
   Path.Combine(AppContext.BaseDirectory,"platform-tools","adb.exe"),
   Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),"Android","Sdk","platform-tools","adb.exe"),
   Path.Combine(Environment.GetEnvironmentVariable("ANDROID_HOME") ?? "", "platform-tools", "adb.exe"),
   Path.Combine(Environment.GetEnvironmentVariable("ANDROID_SDK_ROOT") ?? "", "platform-tools", "adb.exe")
  };
  return candidates.FirstOrDefault(File.Exists) ?? "adb";
 }
 private static async Task<string> RunAsync(string[] args) {
  using var process = new Process { StartInfo = new ProcessStartInfo(AdbPath()) {
   UseShellExecute=false, CreateNoWindow=true, RedirectStandardOutput=true, RedirectStandardError=true
  }};
  foreach (var arg in args) process.StartInfo.ArgumentList.Add(arg);
  try { process.Start(); }
  catch (System.ComponentModel.Win32Exception) { throw new InvalidOperationException("ADB introuvable. Installez Android SDK Platform-Tools, puis ajoutez son dossier au PATH ou placez platform-tools à côté du Studio."); }
  var output = process.StandardOutput.ReadToEndAsync();
  var error = process.StandardError.ReadToEndAsync();
  using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(15));
  try { await process.WaitForExitAsync(timeout.Token); }
  catch (OperationCanceledException) {
   try { process.Kill(); } catch (InvalidOperationException) { }
   throw new TimeoutException("ADB ne répond pas. Vérifiez le câble et l’autorisation sur le téléphone, puis réessayez.");
  }
  var stdout = await output; var stderr = await error;
  if (process.ExitCode != 0) throw new InvalidOperationException("Connexion USB impossible : " + stderr.Trim());
  return stdout;
 }
}
