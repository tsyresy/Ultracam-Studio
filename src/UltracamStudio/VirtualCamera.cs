using System.IO.MemoryMappedFiles;
namespace UltracamStudio;
// Implements the published UnityCapture shared-memory wire layout (MIT).
public sealed class VirtualCamera : IDisposable {
 private readonly EventWaitHandle want=new(false,EventResetMode.AutoReset,"UnityCapture_Want");
 private EventWaitHandle? sent;
 private Mutex? mutex;
 private MemoryMappedFile? memory;
 private MemoryMappedViewAccessor? view;
 private byte[] rgba=[];
 public bool Send(byte[] bgra,int width,int height){
  try{
   if(view==null){mutex??=Mutex.OpenExisting("UnityCapture_Mutx");sent??=EventWaitHandle.OpenExisting("UnityCapture_Sent");memory??=MemoryMappedFile.OpenExisting("UnityCapture_Data");view=memory.CreateViewAccessor();}
   if(rgba.Length!=bgra.Length)rgba=new byte[bgra.Length];
   // DirectShow positive-height RGB is bottom-up; UnityCapture performs color conversion only.
   for(int y=0;y<height;y++)for(int x=0;x<width;x++){int s=(y*width+x)*4,d=((height-1-y)*width+x)*4;rgba[d]=bgra[s+2];rgba[d+1]=bgra[s+1];rgba[d+2]=bgra[s];rgba[d+3]=255;}
   bool acquired;try{acquired=mutex!.WaitOne(10);}catch(AbandonedMutexException){acquired=true;}
   if(!acquired)return false;
   try{if(view.ReadUInt32(0)<rgba.Length)return false;view.Write(4,width);view.Write(8,height);view.Write(12,width);view.Write(16,0);view.Write(20,1);view.Write(24,0);view.Write(28,1000);view.WriteArray(32,rgba,0,rgba.Length);}finally{mutex!.ReleaseMutex();}
   sent!.Set();want.WaitOne(0);return true;
  }catch(Exception e) when(e is WaitHandleCannotBeOpenedException or FileNotFoundException or IOException){return false;}
 }
 public void Dispose(){view?.Dispose();memory?.Dispose();mutex?.Dispose();sent?.Dispose();want.Dispose();}
}
