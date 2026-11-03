using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Builder;
using Microsoft.AspNetCore.Hosting;
using Microsoft.AspNetCore.Http;
using Microsoft.Extensions.Logging;
namespace UltracamStudio;
public sealed class StreamServer : IAsyncDisposable {
 public const int Port=49721;
 private WebApplication? app;
 private WebSocket? active;
 private readonly SemaphoreSlim sendLock=new(1,1);
 private readonly object gate=new();
 public string Token {get;private set;}=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));
 public event Action<byte[]>? Frame;
 public event Action<string>? Device;
 public event Action<string>? Status;
 public string PairingUrl(string ip)=>$"ws://{ip}:{Port}/stream?token={Token}";
 public static string[] Addresses()=>NetworkInterface.GetAllNetworkInterfaces().Where(n=>n.OperationalStatus==OperationalStatus.Up&&n.NetworkInterfaceType!=NetworkInterfaceType.Loopback).SelectMany(n=>n.GetIPProperties().UnicastAddresses).Where(a=>a.Address.AddressFamily==AddressFamily.InterNetwork).Select(a=>a.Address.ToString()).Distinct().DefaultIfEmpty("127.0.0.1").ToArray();
 public async Task StartAsync(){
  var builder=WebApplication.CreateSlimBuilder();builder.Logging.ClearProviders();builder.WebHost.UseUrls($"http://0.0.0.0:{Port}");
  app=builder.Build();app.UseWebSockets(new WebSocketOptions{KeepAliveInterval=TimeSpan.FromSeconds(15)});
  app.MapGet("/health",()=>Results.Json(new{app="Ultracam Studio Pro",protocol=1}));
  app.Map("/stream",Handle);await app.StartAsync();
 }
 public void RenewToken(){lock(gate){Token=Convert.ToHexString(RandomNumberGenerator.GetBytes(32));active?.Abort();}}
 private async Task Handle(HttpContext ctx){
  if(!ctx.WebSockets.IsWebSocketRequest){ctx.Response.StatusCode=400;return;}
  var candidate=Encoding.UTF8.GetBytes(ctx.Request.Query["token"].ToString());
  WebSocket ws;
  lock(gate){if(!CryptographicOperations.FixedTimeEquals(candidate,Encoding.UTF8.GetBytes(Token))){ctx.Response.StatusCode=401;return;}if(active!=null){ctx.Response.StatusCode=409;return;}}
  ws=await ctx.WebSockets.AcceptWebSocketAsync();
  lock(gate){if(active!=null||!CryptographicOperations.FixedTimeEquals(candidate,Encoding.UTF8.GetBytes(Token))){ws.Abort();ws.Dispose();return;}active=ws;}
  Status?.Invoke("Téléphone connecté");
  try{
   var buffer=new byte[65536];
   while(ws.State==WebSocketState.Open&&!ctx.RequestAborted.IsCancellationRequested){
    using var message=new MemoryStream();WebSocketReceiveResult part;
    do { part=await ws.ReceiveAsync(new ArraySegment<byte>(buffer),ctx.RequestAborted);if(part.MessageType==WebSocketMessageType.Close)return;
     if(message.Length+part.Count>8*1024*1024){await ws.CloseAsync(WebSocketCloseStatus.MessageTooBig,"Frame exceeds 8 MiB",CancellationToken.None);return;}
     message.Write(buffer,0,part.Count);
    }while(!part.EndOfMessage);
    if(part.MessageType==WebSocketMessageType.Binary){var bytes=message.ToArray();if(bytes.Length>4&&bytes[0]==255&&bytes[1]==216)Frame?.Invoke(bytes);}
    else {using var json=JsonDocument.Parse(message.ToArray());if(json.RootElement.TryGetProperty("type",out var type)&&type.GetString()=="hello"&&json.RootElement.TryGetProperty("name",out var name))Device?.Invoke((name.GetString()??"Téléphone")[..Math.Min(80,(name.GetString()??"Téléphone").Length)]);}
   }
  }catch(Exception e) when(e is WebSocketException or OperationCanceledException or JsonException){Status?.Invoke("Téléphone déconnecté");}
  finally {lock(gate){if(ReferenceEquals(active,ws))active=null;}ws.Dispose();Device?.Invoke("Aucun téléphone connecté");Status?.Invoke("En attente d’un téléphone");}
 }
 public async Task CommandAsync(string type,object value){await sendLock.WaitAsync();try{var ws=active;if(ws?.State==WebSocketState.Open)await ws.SendAsync(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new{type,value})),WebSocketMessageType.Text,true,CancellationToken.None);}catch(WebSocketException){Status?.Invoke("Commande non transmise : téléphone déconnecté");}finally{sendLock.Release();}}
 public async ValueTask DisposeAsync(){active?.Abort();if(app!=null){await app.StopAsync();await app.DisposeAsync();}sendLock.Dispose();}
}
