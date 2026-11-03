using System.Diagnostics;
using System.IO;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using System.Windows.Threading;
using QRCoder;
namespace UltracamStudio;
public partial class MainWindow : Window {
 private readonly StreamServer server=new();
 private readonly VirtualCamera virtualCamera=new();
 private readonly DispatcherTimer timer=new(){Interval=TimeSpan.FromMilliseconds(33)};
 private readonly Stopwatch clock=Stopwatch.StartNew();
 private byte[]? pending;
 private BitmapSource? source,lastOutput;
 private byte[]? lastJpeg;
 private AviRecorder? recording;
 private long recordStart;
 private long recordedFrames;
 private int rotation,frameCount;
 private string renderSettings="";
 private long lastStats,lastReceived;
 private bool closing;
 private readonly string captures=Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyVideos),"Ultracam");
 public MainWindow(){
  InitializeComponent();
  AddressSelector.ItemsSource=StreamServer.Addresses();AddressSelector.SelectedIndex=0;
  server.Frame+=bytes=>Interlocked.Exchange(ref pending,bytes);
  server.Device+=name=>Dispatcher.BeginInvoke(()=>DeviceName.Text=name);
  server.Status+=message=>Dispatcher.BeginInvoke(()=>StatusText.Text=message);
  timer.Tick+=Tick;Loaded+=async(_,_)=>{try{await server.StartAsync();StatusText.Text="Studio prêt · Autorisez le réseau privé dans le pare-feu Windows";timer.Start();}catch(Exception e){StatusText.Text="Serveur indisponible : "+e.Message;MessageBox.Show(e.Message,"Connexion impossible");}};
  Closing+=async(_,e)=>{if(closing)return;e.Cancel=true;closing=true;timer.Stop();try{StopRecording();virtualCamera.Dispose();await server.DisposeAsync();}finally{Close();}};
 }
 private void Pair(){if(PairingQr==null||AddressSelector.SelectedItem is not string ip)return;using var gen=new QRCodeGenerator();using var data=gen.CreateQrCode(server.PairingUrl(ip),QRCodeGenerator.ECCLevel.M);using var png=new PngByteQRCode(data);PairingQr.Source=Decode(png.GetGraphic(6));}
 private void Address_Changed(object sender,SelectionChangedEventArgs e)=>Pair();
 private void CopyPairing_Click(object sender,RoutedEventArgs e){if(AddressSelector.SelectedItem is string ip){Clipboard.SetText(server.PairingUrl(ip));StatusText.Text="Lien copié";}}
 private void RenewPairing_Click(object sender,RoutedEventArgs e){server.RenewToken();Pair();StatusText.Text="Nouveau code créé · Reconnectez le téléphone";}
 private static BitmapSource Decode(byte[] bytes){using var memory=new MemoryStream(bytes);var image=BitmapFrame.Create(memory,BitmapCreateOptions.None,BitmapCacheOption.OnLoad);image.Freeze();return image;}
 private void Tick(object? sender,EventArgs e){
  var bytes=Interlocked.Exchange(ref pending,null);
  try{
   if(bytes!=null){source=Decode(bytes);if(source.PixelWidth>4096||source.PixelHeight>4096){source=null;throw new InvalidDataException("Image trop grande");}lastReceived=clock.ElapsedMilliseconds;frameCount++;}
   if(source!=null){
    var settings=$"{Exposure.Value}|{Contrast.Value}|{Saturation.Value}|{Temperature.Value}|{Gamma.Value}|{rotation}|{Mirror.IsChecked}|{FillFrame.IsChecked}";
    bool changed=bytes!=null||lastOutput==null||settings!=renderSettings;
    if(changed){lastOutput=Render(source);renderSettings=settings;VideoPreview.Source=lastOutput;lastJpeg=null;}
    var output=lastOutput!;EmptyState.Visibility=Visibility.Collapsed;
    bool fresh=clock.ElapsedMilliseconds-lastReceived<2000;
    LiveLabel.Text=fresh?"● EN DIRECT":"SOURCE INTERROMPUE";
    if(VirtualEnabled.IsChecked==true&&fresh){var pixels=new byte[1280*720*4];output.CopyPixels(pixels,1280*4,0);CameraStatus.Text=virtualCamera.Send(pixels,1280,720)?"Sortie DirectShow active":"Ouvrez Ultracam dans votre logiciel vidéo";}
    if(recording!=null&&!fresh){StopRecording();StatusText.Text="Enregistrement arrêté : caméra déconnectée";}
    if(recording!=null){
     if(lastJpeg==null){var jpeg=new JpegBitmapEncoder{QualityLevel=85};jpeg.Frames.Add(BitmapFrame.Create(output));using var ms=new MemoryStream();jpeg.Save(ms);lastJpeg=ms.ToArray();}
     var target=(clock.ElapsedMilliseconds-recordStart)*15/1000;
     while(recordedFrames<=target){recording.AddFrame(lastJpeg);recordedFrames++;}
     RecordingLabel.Text=TimeSpan.FromMilliseconds(clock.ElapsedMilliseconds-recordStart).ToString(@"hh\:mm\:ss");
    }
   }
   if(clock.ElapsedMilliseconds-lastStats>=1000){FpsLabel.Text=$"{frameCount*1000.0/(clock.ElapsedMilliseconds-lastStats):F1} fps";frameCount=0;lastStats=clock.ElapsedMilliseconds;}
  }catch(Exception ex){StatusText.Text=ex.Message;if(recording!=null)StopRecording();}
 }
 private BitmapSource Render(BitmapSource input){
  var visual=new DrawingVisual();using(var dc=visual.RenderOpen()){
   dc.DrawRectangle(Brushes.Black,null,new Rect(0,0,1280,720));dc.PushClip(new RectangleGeometry(new Rect(0,0,1280,720)));
   double w=input.PixelWidth,h=input.PixelHeight;if(rotation%180!=0)(w,h)=(h,w);
   double scale=FillFrame.IsChecked==true?Math.Max(1280/w,720/h):Math.Min(1280/w,720/h);
   dc.PushTransform(new TranslateTransform(640,360));dc.PushTransform(new ScaleTransform(Mirror.IsChecked==true?-scale:scale,scale));dc.PushTransform(new RotateTransform(rotation));
   dc.DrawImage(input,new Rect(-input.PixelWidth/2.0,-input.PixelHeight/2.0,input.PixelWidth,input.PixelHeight));dc.Pop();dc.Pop();dc.Pop();dc.Pop();
  }
  var bitmap=new RenderTargetBitmap(1280,720,96,96,PixelFormats.Pbgra32);bitmap.Render(visual);var pixels=new byte[1280*720*4];bitmap.CopyPixels(pixels,1280*4,0);
  ImageAdjustments.Apply(pixels,Exposure.Value,Contrast.Value,Saturation.Value,Temperature.Value,Gamma.Value);
  var result=BitmapSource.Create(1280,720,96,96,PixelFormats.Bgra32,null,pixels,1280*4);result.Freeze();return result;
 }
 private async void Lens_Click(object sender,RoutedEventArgs e)=>await server.CommandAsync("facing",((Button)sender).Tag.ToString()!);
 private async void Torch_Click(object sender,RoutedEventArgs e)=>await server.CommandAsync("torch",Torch.IsChecked==true);
 private async void CameraZoom_Changed(object sender,RoutedPropertyChangedEventArgs<double> e){if(IsLoaded)await server.CommandAsync("zoom",e.NewValue);}
 private void Rotate_Click(object sender,RoutedEventArgs e)=>rotation=(rotation+90)%360;
 private void Reset_Click(object sender,RoutedEventArgs e){Exposure.Value=0;Contrast.Value=1;Saturation.Value=1;Temperature.Value=0;Gamma.Value=1;rotation=0;Mirror.IsChecked=false;FillFrame.IsChecked=false;}
 private void Preset_Click(object sender,RoutedEventArgs e){Reset_Click(sender,e);switch(((Button)sender).Tag){case "bright":Exposure.Value=.35;Contrast.Value=1.08;break;case "warm":Temperature.Value=.5;Contrast.Value=1.15;Saturation.Value=.85;break;case "mono":Saturation.Value=0;Contrast.Value=1.2;break;case "vivid":Saturation.Value=1.4;Contrast.Value=1.12;break;}}
 private void Virtual_Click(object sender,RoutedEventArgs e)=>CameraStatus.Text=VirtualEnabled.IsChecked==true?"En attente d’un logiciel vidéo":"Caméra virtuelle désactivée";
 private void Record_Click(object sender,RoutedEventArgs e){try{if(recording!=null){StopRecording();return;}if(lastOutput==null){StatusText.Text="Connectez une caméra avant d’enregistrer";return;}Directory.CreateDirectory(captures);var path=Path.Combine(captures,$"Ultracam-{DateTime.Now:yyyyMMdd-HHmmss-fff}.avi");recording=new AviRecorder(path,1280,720,15);recordStart=clock.ElapsedMilliseconds;recordedFrames=0;lastJpeg=null;RecordButton.Content="■  Arrêter";StatusText.Text="Enregistrement vidéo (sans audio) : "+path;}catch(Exception ex){StatusText.Text=ex.Message;}}
 private void StopRecording(){var writer=recording;recording=null;try{writer?.Dispose();}catch(Exception e){StatusText.Text="Erreur de finalisation : "+e.Message;}RecordButton.Content="●  Enregistrer";RecordingLabel.Text="Prêt";}
 private void Snapshot_Click(object sender,RoutedEventArgs e){if(lastOutput==null)return;try{Directory.CreateDirectory(captures);var encoder=new PngBitmapEncoder();encoder.Frames.Add(BitmapFrame.Create(lastOutput));var path=Path.Combine(captures,$"Ultracam-{DateTime.Now:yyyyMMdd-HHmmss-fff}.png");using var file=File.Create(path);encoder.Save(file);StatusText.Text="Photo enregistrée : "+path;}catch(Exception ex){StatusText.Text=ex.Message;}}
 private void OpenCaptures_Click(object sender,RoutedEventArgs e){Directory.CreateDirectory(captures);Process.Start(new ProcessStartInfo(captures){UseShellExecute=true});}
 private void InstallCamera_Click(object sender,RoutedEventArgs e){try{var script=Path.Combine(AppContext.BaseDirectory,"camera","Install-Camera.ps1");if(!File.Exists(script))throw new FileNotFoundException("Le dossier camera doit accompagner l’EXE.");Process.Start(new ProcessStartInfo("powershell.exe",$"-NoProfile -ExecutionPolicy Bypass -File \"{script}\""){UseShellExecute=true,Verb="runas"});StatusText.Text="Suivez l’installation Windows puis redémarrez votre logiciel vidéo";}catch(Exception ex){StatusText.Text="Installation non effectuée : "+ex.Message;}}
}
