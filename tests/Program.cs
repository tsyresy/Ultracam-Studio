using System.Net.WebSockets;
using System.Text;
using UltracamStudio;
static void Check(bool condition,string message){if(!condition)throw new Exception(message);Console.WriteLine("PASS "+message);}
var p=new byte[]{10,100,230,255};var original=p.ToArray();ImageAdjustments.Apply(p,0,1,1,0,1);Check(p.SequenceEqual(original),"neutral image settings preserve pixels");ImageAdjustments.Apply(p,0,1,0,0,1);Check(p[0]==p[1]&&p[1]==p[2]&&p[3]==255,"monochrome preserves alpha and removes chroma");
var avi=Path.Combine(Path.GetTempPath(),"ultracam-test-"+Guid.NewGuid()+".avi");using(var writer=new AviRecorder(avi,1280,720,15)){writer.AddFrame([255,216,1,255,217]);writer.AddFrame([255,216,255,217]);}
var data=File.ReadAllBytes(avi);Check(Encoding.ASCII.GetString(data,0,4)=="RIFF"&&BitConverter.ToUInt32(data,4)==data.Length-8,"AVI RIFF size finalized");var text=Encoding.Latin1.GetString(data);var idx=text.IndexOf("idx1",StringComparison.Ordinal);Check(idx>0&&BitConverter.ToUInt32(data,idx+4)==32,"AVI index contains two frames");var avih=text.IndexOf("avih",StringComparison.Ordinal);Check(BitConverter.ToUInt32(data,avih+24)==2,"AVI frame count finalized");File.Delete(avi);
await using var server=new StreamServer();await server.StartAsync();
using var http=new HttpClient();var health=await http.GetStringAsync($"http://127.0.0.1:{StreamServer.Port}/health");Check(health.Contains("Ultracam"),"health endpoint");
using(var invalid=new ClientWebSocket()){bool rejected=false;try{await invalid.ConnectAsync(new Uri($"ws://127.0.0.1:{StreamServer.Port}/stream?token=bad"),CancellationToken.None);}catch(WebSocketException){rejected=true;}Check(rejected,"invalid pairing token rejected");}
var received=new TaskCompletionSource<byte[]>(TaskCreationOptions.RunContinuationsAsynchronously);server.Frame+=b=>received.TrySetResult(b);
using var phone=new ClientWebSocket();await phone.ConnectAsync(new Uri(server.PairingUrl("127.0.0.1")),CancellationToken.None);
using(var second=new ClientWebSocket()){bool rejected=false;try{await second.ConnectAsync(new Uri(server.PairingUrl("127.0.0.1")),CancellationToken.None);}catch(WebSocketException){rejected=true;}Check(rejected,"second simultaneous camera rejected");}
await phone.SendAsync(new byte[]{255,216},WebSocketMessageType.Binary,false,CancellationToken.None);await phone.SendAsync(new byte[]{255,217,0},WebSocketMessageType.Binary,true,CancellationToken.None);var frame=await received.Task.WaitAsync(TimeSpan.FromSeconds(3));Check(frame.Length==5&&frame[0]==255,"fragmented video frame reassembled");
await server.CommandAsync("zoom",.5);var buffer=new byte[1000];var command=await phone.ReceiveAsync(buffer,CancellationToken.None);Check(Encoding.UTF8.GetString(buffer,0,command.Count).Contains("zoom"),"camera control delivered");
var previous=server.Token;server.RenewToken();Check(previous!=server.Token,"pairing renewal invalidates old secret");
var devices=UsbConnection.ParseDevices("List of devices attached\nSERIAL_1\tdevice\nSERIAL_2\tunauthorized\nSERIAL_3\toffline\n* daemon started successfully *\n");
Check(devices.Length==3 && devices[0].State=="device" && devices[1].State=="unauthorized", "ADB device discovery preserves authorization states");
var calls=new List<string[]>();
var usb=new UsbConnection(args=>{calls.Add(args);return Task.FromResult(args.SequenceEqual(new[]{"devices"}) ? "SERIAL_1\tdevice\n" : "");});
Check((await usb.DevicesAsync()).Single().Serial=="SERIAL_1", "USB discovery delegates to ADB");
await usb.ConnectAsync(devices[0]);
Check(calls.Last().SequenceEqual(new[]{"-s","SERIAL_1","reverse","tcp:49721","tcp:49721"}), "USB tunnel targets the selected device and Studio port");
var count=calls.Count;bool denied=false;
try{await usb.ConnectAsync(devices[1]);}catch(InvalidOperationException){denied=true;}
Check(denied && calls.Count==count,"unauthorized USB device cannot create tunnel");
var failedUsb=new UsbConnection(_=>Task.FromException<string>(new InvalidOperationException("offline")));
bool failed=false;try{await failedUsb.ConnectAsync(devices[0]);}catch(InvalidOperationException){failed=true;}
Check(failed,"ADB failure is surfaced instead of reporting connection success");
Console.WriteLine("All checks passed.");
