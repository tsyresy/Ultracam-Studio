using System.Text;
namespace UltracamStudio;
// RIFF AVI 1.0, single MJPEG stream. A fixed-rate scheduler supplies frames.
public sealed class AviRecorder : IDisposable {
 private readonly BinaryWriter w;
 private readonly List<(uint Offset,uint Size)> index=[];
 private readonly long riffSize,totalFrames,streamFrames,moviSize,moviStart;
 private bool closed;
 public AviRecorder(string path,int width,int height,int fps){
  w=new BinaryWriter(new FileStream(path,FileMode.CreateNew,FileAccess.ReadWrite,FileShare.Read));
  Tag("RIFF");riffSize=w.BaseStream.Position;w.Write(0);Tag("AVI ");Tag("LIST");var hdrl=Size();Tag("hdrl");
  Tag("avih");w.Write(56);w.Write(1_000_000/fps);w.Write(width*height*3*fps);w.Write(0);w.Write(0x10);totalFrames=w.BaseStream.Position;w.Write(0);w.Write(0);w.Write(1);w.Write(width*height*3);w.Write(width);w.Write(height);for(int i=0;i<4;i++)w.Write(0);
  Tag("LIST");var strl=Size();Tag("strl");Tag("strh");w.Write(56);Tag("vids");Tag("MJPG");w.Write(0);w.Write((short)0);w.Write((short)0);w.Write(0);w.Write(1);w.Write(fps);w.Write(0);streamFrames=w.BaseStream.Position;w.Write(0);w.Write(width*height*3);w.Write(-1);w.Write(0);w.Write((short)0);w.Write((short)0);w.Write((short)width);w.Write((short)height);
  Tag("strf");w.Write(40);w.Write(40);w.Write(width);w.Write(height);w.Write((short)1);w.Write((short)24);Tag("MJPG");w.Write(width*height*3);for(int i=0;i<4;i++)w.Write(0);Finish(strl);Finish(hdrl);
  Tag("LIST");moviSize=Size();moviStart=w.BaseStream.Position;Tag("movi");
 }
 public void AddFrame(byte[] jpeg){
  ObjectDisposedException.ThrowIf(closed,this);
  if(w.BaseStream.Position+jpeg.Length+index.Count*16L>1_900_000_000)throw new IOException("Limite AVI de 1,9 Go atteinte. Démarrez un nouvel enregistrement.");
  var offset=checked((uint)(w.BaseStream.Position-moviStart));Tag("00dc");w.Write(jpeg.Length);w.Write(jpeg);if((jpeg.Length&1)!=0)w.Write((byte)0);index.Add((offset,(uint)jpeg.Length));
 }
 private void Tag(string text)=>w.Write(Encoding.ASCII.GetBytes(text));
 private long Size(){var pos=w.BaseStream.Position;w.Write(0);return pos;}
 private void Patch(long pos,uint value){var end=w.BaseStream.Position;w.BaseStream.Position=pos;w.Write(value);w.BaseStream.Position=end;}
 private void Finish(long pos)=>Patch(pos,checked((uint)(w.BaseStream.Position-pos-4)));
 public void Dispose(){if(closed)return;closed=true;try{Finish(moviSize);Tag("idx1");w.Write(index.Count*16);foreach(var item in index){Tag("00dc");w.Write(0x10);w.Write(item.Offset);w.Write(item.Size);}Patch(totalFrames,(uint)index.Count);Patch(streamFrames,(uint)index.Count);Finish(riffSize);}finally{w.Dispose();}}
}
