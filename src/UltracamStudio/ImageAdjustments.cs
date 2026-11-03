namespace UltracamStudio;
public static class ImageAdjustments {
 public static void Apply(byte[] pixels,double exposure,double contrast,double saturation,double temperature,double gamma){
  if(exposure==0&&contrast==1&&saturation==1&&temperature==0&&gamma==1)return;
  var gain=Math.Pow(2,exposure);var lut=new byte[256];for(int i=0;i<256;i++)lut[i]=(byte)Math.Clamp(Math.Round(Math.Pow(i/255.0,1/gamma)*255),0,255);
  Parallel.For(0,pixels.Length/4,i=>{int p=i*4;double b=pixels[p],g=pixels[p+1],r=pixels[p+2];double l=.2126*r+.7152*g+.0722*b;
   r=((l+(r-l)*saturation)*gain-127.5)*contrast+127.5+temperature*25;
   g=((l+(g-l)*saturation)*gain-127.5)*contrast+127.5;
   b=((l+(b-l)*saturation)*gain-127.5)*contrast+127.5-temperature*25;
   pixels[p]=lut[(int)Math.Clamp(b,0,255)];pixels[p+1]=lut[(int)Math.Clamp(g,0,255)];pixels[p+2]=lut[(int)Math.Clamp(r,0,255)];
  });
 }
}
