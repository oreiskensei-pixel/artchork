/* ART+CHORK scene: every artichoke is built from scratch in three.js.
   Bracts are parametric surfaces deformed in the vertex shader (so all petals open on scroll), with procedural
   veins/bump in the fragment shader. Florets are tapered tubes, dewdrops ride on the bracts, stems and leaves are modelled too. */
const RM=matchMedia("(prefers-reduced-motion: reduce)").matches;
const LOW=innerWidth<720;
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x)),lerp=(a,b,t)=>a+(b-a)*t;
const sstep=(a,b,x)=>{const t=clamp((x-a)/(b-a));return t*t*(3-2*t)};
const rng=s=>()=>{s|=0;s=s+0x6D2B79F5|0;let t=Math.imul(s^s>>>15,1|s);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const MONO='11px "IBM Plex Mono",ui-monospace,monospace';
const FOV=32,T2=Math.tan(FOV*Math.PI/360);

/* ---------- canvases: bg (2D) / gl (three) / fx (2D tracking) ---------- */
const fxc=document.getElementById("c"),ctx=fxc.getContext("2d");
function layer(id,z){const c=document.createElement("canvas");c.id=id;c.setAttribute("aria-hidden","true");c.style.cssText=`position:fixed;inset:0;width:100%;height:100%;z-index:${z};display:block`;document.body.insertBefore(c,fxc);return c}
const bgCv=layer("bg",0),glCv=layer("gl",1),bgc=bgCv.getContext("2d");
fxc.style.zIndex=2;fxc.style.pointerEvents="none";
if(!window.THREE){document.body.insertAdjacentHTML("afterbegin",'<p style="position:fixed;z-index:50;left:16px;bottom:16px;font:12px monospace;color:#999">3D library failed to load.</p>')}
const R=new THREE.WebGLRenderer({canvas:glCv,antialias:true,alpha:true,powerPreference:"high-performance"});
R.outputEncoding=THREE.sRGBEncoding;R.toneMapping=THREE.ACESFilmicToneMapping;R.toneMappingExposure=.88;
R.shadowMap.enabled=true;R.shadowMap.type=THREE.PCFSoftShadowMap;
const scene=new THREE.Scene(),cam=new THREE.PerspectiveCamera(FOV,1,.1,120);
scene.fog=new THREE.Fog(0x000000,18,36);

/* soft-box environment so surfaces catch believable highlights */
(function(){
  const es=new THREE.Scene();
  es.add(new THREE.Mesh(new THREE.SphereGeometry(30,32,16),new THREE.MeshBasicMaterial({color:0x040605,side:THREE.BackSide})));
  const panel=(w,h,col,k,pos)=>{const m=new THREE.Mesh(new THREE.PlaneGeometry(w,h),new THREE.MeshBasicMaterial({color:new THREE.Color(col).multiplyScalar(k),side:THREE.DoubleSide}));m.position.set(...pos);m.lookAt(0,0,0);es.add(m)};
  panel(16,3,0xffe0b8,10,[-14,9,7]);panel(3,18,0xb8a0ff,7,[15,2,-7]);panel(12,2,0xffffff,3,[0,16,-4]);panel(10,3,0x70a67c,1.4,[0,-14,7]);
  const pm=new THREE.PMREMGenerator(R);scene.environment=pm.fromScene(es,.02).texture;pm.dispose();
})();
scene.add(new THREE.HemisphereLight(0x55607a,0x1f2a1c,.34));
const key=new THREE.DirectionalLight(0xffe0b0,2.1);key.castShadow=true;
key.shadow.mapSize.set(LOW?1024:3072,LOW?1024:3072);key.shadow.bias=-.0005;key.shadow.normalBias=.03;
Object.assign(key.shadow.camera,{left:-6,right:6,top:6,bottom:-6,near:.5,far:30});
scene.add(key,key.target);
const rimL=new THREE.DirectionalLight(0x9a8cff,1.0);rimL.position.set(7,2.5,-5);scene.add(rimL);

/* ---------- GLSL: bract surface ---------- */
const B_DECL=`
uniform float uBloom; uniform float uCore;
attribute vec4 aP0; attribute vec4 aP1; attribute vec4 aP2;
float bW(float u){ return pow(max(1.0-u*u,0.0),0.52); }
float sinc(float z){ return abs(z)<1e-4 ? 1.0 : sin(z)/z; }
vec3 bP(float u,float v){
  float phi=aP0.x,h=aP0.y,rho=aP0.z,core=1.-uCore*step(7.5,aP0.w),len=aP1.x*core,wid=aP1.y*core;
  float open=smoothstep(aP2.z,aP2.z+0.55,uBloom);
  float th0=mix(aP1.z,aP1.w,open);
  float k=mix(aP2.x,aP2.y,open);
  float th=th0+k*u, hm=th0+0.5*k*u, sc=len*u*sinc(0.5*k*u);
  float rad=sc*sin(hm);
  float up=sc*cos(hm);
  float w=wid*bW(u)*(1.0+0.05*sin(u*22.0+aP2.w*40.0)*u);
  float lat=v*w;
  float cup=mix(0.75,0.28,open)*v*v*w*(0.3+0.7*u);
  float rib=0.16*w*(1.0-abs(v))*(1.0-abs(v))*(1.0-u*0.6);
  float off=cup-rib;
  float Rr=rho+rad-off*cos(th);
  float Uu=h+up+off*sin(th);
  return vec3(Rr*cos(phi)-lat*sin(phi), Uu, Rr*sin(phi)+lat*cos(phi));
}
vec3 bN(float u,float v){
  float e=0.012; float u0=clamp(u,e,1.0-e); float v0=clamp(v,-1.0+e,1.0-e);
  vec3 pu=bP(u0+e,v0)-bP(u0-e,v0); vec3 pv=bP(u0,v0+e)-bP(u0,v0-e);
  return normalize(cross(pu,pv)+vec3(1e-6));
}`;
const NOISE=`
float hsh(vec2 p){return fract(sin(dot(p,vec2(127.1,311.7)))*43758.5453);}
float vn(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(hsh(i),hsh(i+vec2(1.,0.)),f.x),mix(hsh(i+vec2(0.,1.)),hsh(i+vec2(1.,1.)),f.x),f.y);}
vec3 S(vec3 c){return pow(c,vec3(2.2));}
float bH;
vec3 bumpN(vec3 pos,vec3 n,float h,float sc){
  vec3 sx=dFdx(pos),sy=dFdy(pos); vec3 r1=cross(sy,n),r2=cross(n,sx); float det=dot(sx,r1);
  float dx=dFdx(h),dy=dFdy(h); vec3 g=sign(det)*(dx*r1+dy*r2); return normalize(abs(det)*n-sc*g);
}`;
const BRACT_FRAG=`
{
 float u=vBI.x, v=vBI.y, rg=vBI.z, sd=vBI.w;
 bool outerSide = dot(normalize(vNormal),normalize(vViewPosition))>0.0;
 float rr=clamp(rg/8.0,0.0,1.0);
 vec3 pale=S(vec3(.28,.33,.19));
 vec3 green=mix(S(vec3(.27,.39,.25)),S(vec3(.31,.27,.38)),rr*.45)*(.9+.2*hsh(vec2(sd*91.,rg)));
 vec3 tipc=mix(S(vec3(.28,.16,.18)),S(vec3(.40,.14,.36)),rr);
 vec3 c=mix(pale,green,smoothstep(.0,.14,u));
 c=mix(c,tipc,smoothstep(.8,.99,u)*.85);
 float bl=vn(vec2(u*3.0+sd*9.0,v*2.0+sd*4.0));
 c=mix(c,S(vec3(.47,.24,.50)),smoothstep(.5,.9,bl)*.3*smoothstep(.3,.8,u));
 float rim=smoothstep(.80,.99,abs(v))*smoothstep(.2,.8,u);
 c=mix(c,S(vec3(.30,.18,.12)),rim*.75);
 float vein=abs(sin(v*30.0+sd*9.0));
 float fine=vn(vec2(u*60.0,v*26.0+sd*30.0));
 c*=.84+.12*vein+.08*fine;
 c*=1.0-.3*step(.986,hsh(floor(vec2(u*90.0,v*40.0+sd*50.0))));
 if(!outerSide){
   c=mix(S(vec3(.20,.23,.14)),c*1.1,smoothstep(.05,.55,u));
   c=mix(c,S(vec3(.75,.55,.78)),smoothstep(.6,1.,u)*rr);
 }
 float inn=smoothstep(7.5,8.5,rg);
 c=mix(c,mix(S(vec3(.88,.80,.90)),S(vec3(.62,.30,.66)),smoothstep(.55,1.,u)),inn*.85);
 c*=mix(.12,1.0,smoothstep(0.0,.6,u));
 bH=(vein*.55+fine*.45)*.0042*(.4+.6*smoothstep(0.,.3,u));
 diffuseColor.rgb=c*uTint*(1.0+.7*uLit);
}`;
function patch(mat,U,frag,vert){
  mat.onBeforeCompile=sh=>{
    for(const k in U)sh.uniforms[k]=U[k];
    sh.vertexShader=sh.vertexShader.replace("#include <common>","#include <common>\n"+vert.decl)
      .replace("#include <beginnormal_vertex>",vert.normal).replace("#include <begin_vertex>",vert.pos);
    if(frag)sh.fragmentShader=sh.fragmentShader.replace("#include <common>","#include <common>\n"+frag.decl)
      .replace("#include <color_fragment>","#include <color_fragment>\n"+frag.color)
      .replace("#include <normal_fragment_maps>","#include <normal_fragment_maps>\n"+(frag.norm||""))
      .replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\n"+(frag.emis||""));
  };
}
const BR_V={decl:B_DECL+"varying vec4 vBI;",normal:"vec3 objectNormal=bN(position.x,position.y);",pos:"vec3 transformed=bP(position.x,position.y); vBI=vec4(position.xy,aP0.w,aP2.w);"};
const BR_F={decl:"varying vec4 vBI; uniform float uLit; uniform vec3 uTint;"+NOISE,color:BRACT_FRAG,
 norm:"normal=bumpN(-vViewPosition,normal,bH,1.0);",
 emis:"{ float fr=pow(1.0-abs(dot(normalize(vNormal),normalize(vViewPosition))),3.0); totalEmissiveRadiance += diffuseColor.rgb*fr*.32*(.4+uLit); }"};
const DEPTH_V={decl:B_DECL,normal:"",pos:"vec3 transformed=bP(position.x,position.y);"};

/* ---------- GLSL: florets ---------- */
const F_V={decl:`uniform float uBloom; attribute vec4 aF0; attribute vec4 aF1; attribute vec4 aF2; varying vec3 vFI;
vec3 fP(vec3 q,out vec3 N){
  float s=q.y; float rn=aF2.y;
  float g=clamp(smoothstep(.5,1.,uBloom)*1.5-.5*rn,0.,1.);
  float L=aF0.w*g;
  vec3 d=normalize(aF1.xyz);
  vec3 o=normalize(vec3(d.x,0.,d.z)+vec3(1e-4,0.,1e-4));
  float bend=aF1.w;
  vec3 c=aF0.xyz+d*(s*L)+o*(s*s*L*bend)-vec3(0.,s*s*L*bend*.35,0.);
  vec3 tg=normalize(d*L+o*(2.*s*L*bend)+vec3(0.,-.7*s*L*bend+1e-5,0.));
  vec3 sd=normalize(cross(tg,vec3(0.,1.,.001)));
  vec3 sd2=cross(tg,sd);
  float r=mix(.014,.0085,s)*(1.0-smoothstep(.96,1.,s))*step(.001,g);
  r*=1.+.55*smoothstep(.86,.92,s)*(1.-smoothstep(.93,.99,s));
  N=normalize(q.x*sd+q.z*sd2);
  return c+(q.x*sd+q.z*sd2)*r;
}`,
 normal:"vec3 fN0; vec3 fPos0=fP(position,fN0); vec3 objectNormal=fN0;",
 pos:"vec3 transformed=fPos0; vFI=vec3(position.y,aF2.y,aF2.x);"};
const F_F={decl:"varying vec3 vFI; uniform float uLit; uniform vec3 uFC;"+NOISE,
 color:`{
  float s=vFI.x, rn=vFI.y, rd=vFI.z;
  vec3 pale=S(vec3(.95,.82,.92)); vec3 col=S(uFC*(.88+.24*rd));
  vec3 c=mix(pale,col,smoothstep(.08,.5,s));
  c=mix(c,pale,(1.-rn)*.7);
  c=mix(c,col*1.5+S(vec3(.12)),smoothstep(.85,1.,s)*.6);
  c=mix(c,S(vec3(.52,.05,.09)),step(.9,rd)*smoothstep(.2,.5,s)*(1.-smoothstep(.8,.95,s))*.85);
  diffuseColor.rgb=c*(1.+.8*uLit);
 }`,emis:"totalEmissiveRadiance += diffuseColor.rgb*(.05+.35*uLit);"};

/* ---------- GLSL: dewdrops riding on a bract ---------- */
const D_V={decl:B_DECL+"attribute vec4 aD;",normal:"vec3 objectNormal=normalize(position);",
 pos:`vec3 dN0=bN(aD.x,aD.y); vec3 dc=bP(aD.x,aD.y)+dN0*aD.w*aD.z*.55;
  vec3 loc=position-dN0*dot(position,dN0)*.32; vec3 transformed=dc+loc*aD.z;`};

/* ---------- shared geometry ---------- */
function planeGrid(NU,NV){
  const p=[],ix=[];
  for(let j=0;j<=NU;j++)for(let i=0;i<=NV;i++)p.push(j/NU,i/NV*2-1,0);
  for(let j=0;j<NU;j++)for(let i=0;i<NV;i++){const a=j*(NV+1)+i,b=a+1,c=a+NV+1,d=c+1;ix.push(a,c,b,b,c,d)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));
  g.setAttribute("normal",new THREE.Float32BufferAttribute(new Array(p.length).fill(0),3));g.setIndex(ix);return g}
function tube(RS,HS){
  const p=[],ix=[];
  for(let j=0;j<=HS;j++)for(let i=0;i<=RS;i++){const a=i/RS*6.2832;p.push(Math.cos(a),j/HS,Math.sin(a))}
  for(let j=0;j<HS;j++)for(let i=0;i<RS;i++){const a=j*(RS+1)+i,b=a+1,c=a+RS+1,d=c+1;ix.push(a,c,b,b,c,d)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(p,3));
  g.setAttribute("normal",new THREE.Float32BufferAttribute(new Array(p.length).fill(0),3));g.setIndex(ix);return g}
const BASE_HI=planeGrid(LOW?24:36,LOW?8:12),BASE_LO=planeGrid(18,7),TUBE_HI=tube(6,10),TUBE_LO=tube(5,7),SPH=new THREE.SphereGeometry(1,12,9);
const LIN=h=>new THREE.Color(h).convertSRGBToLinear();

/* curved, tapered stem */
function stemGeo(pts,r0,r1,seg,rad){
  const curve=new THREE.CatmullRomCurve3(pts),fr=curve.computeFrenetFrames(seg,false),pos=[],nor=[],ix=[];
  for(let i=0;i<=seg;i++){const p=curve.getPointAt(i/seg),N=fr.normals[i],B=fr.binormals[i],r=lerp(r0,r1,i/seg);
    for(let j=0;j<=rad;j++){const a=j/rad*6.2832,c=Math.cos(a),s=Math.sin(a),nx=N.x*c+B.x*s,ny=N.y*c+B.y*s,nz=N.z*c+B.z*s;
      pos.push(p.x+nx*r,p.y+ny*r,p.z+nz*r);nor.push(nx,ny,nz)}}
  for(let i=0;i<seg;i++)for(let j=0;j<rad;j++){const a=i*(rad+1)+j,b=a+1,c=a+rad+1,d=c+1;ix.push(a,c,b,b,c,d)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute("normal",new THREE.Float32BufferAttribute(nor,3));g.setIndex(ix);return{geo:g,curve};
}
/* lobed artichoke leaf: +z is the length, arching up then drooping, channelled across */
const LEAF=(()=>{
  const NL=44,NW=8,pos=[],col=[],ix=[];
  for(let j=0;j<=NL;j++){const u=j/NL,env=Math.pow(Math.sin(Math.PI*Math.pow(u,.75)),.8),lobe=.55+.45*Math.pow(Math.abs(Math.sin(u*15.7)),.7),w=.36*env*lobe*(u<.08?u/.08:1);
    for(let i=0;i<=NW;i++){const v=i/NW*2-1,fold=Math.abs(v)*w*.35;
      pos.push(v*w,.45*u-.75*u*u+fold,u);
      const m=Math.exp(-v*v*16),sh=.75+.25*(1-Math.abs(v)),tip=.85+.15*(1-u);
      const r=lerp(.13,.28,m)*sh*tip*.62,g=lerp(.20,.34,m)*sh*tip*.62,b=lerp(.12,.24,m)*sh*tip*.62;
      col.push(Math.pow(r,2.2),Math.pow(g,2.2),Math.pow(b,2.2))}}
  for(let j=0;j<NL;j++)for(let i=0;i<NW;i++){const a=j*(NW+1)+i,b=a+1,c=a+NW+1,d=c+1;ix.push(a,c,b,b,c,d)}
  const g=new THREE.BufferGeometry();g.setAttribute("position",new THREE.Float32BufferAttribute(pos,3));
  g.setAttribute("color",new THREE.Float32BufferAttribute(col,3));g.setIndex(ix);g.computeVertexNormals();return g})();
const LEAFMAT=new THREE.MeshStandardMaterial({vertexColors:true,side:THREE.DoubleSide,roughness:.85,metalness:0,envMapIntensity:.25});
LEAFMAT.onBeforeCompile=sh=>{sh.fragmentShader=sh.fragmentShader.replace("#include <color_fragment>","#include <color_fragment>\nif(!gl_FrontFacing) diffuseColor.rgb*=vec3(1.45,1.5,1.4);")};
const LEAFSIDE=LEAFMAT.clone();LEAFSIDE.color=new THREE.Color(3,3,3);LEAFSIDE.onBeforeCompile=LEAFMAT.onBeforeCompile;
const STEMMAT=new THREE.MeshStandardMaterial({color:LIN(0x425c3c),roughness:.8,envMapIntensity:.2});

/* rows of bracts, outermost first. Lengths and radii are in units of flower size. */
const RINGS=[
 {n:9,h:0.000,rho:.40,len:.62,wid:.30,tc:.42,to:1.40,cc:-.35,co:.50,dl:0.00},
 {n:9,h:0.085,rho:.43,len:.60,wid:.30,tc:.36,to:1.32,cc:-.30,co:.46,dl:0.05},
 {n:10,h:0.170,rho:.45,len:.58,wid:.30,tc:.30,to:1.22,cc:-.28,co:.42,dl:0.10},
 {n:10,h:0.255,rho:.46,len:.56,wid:.29,tc:.25,to:1.12,cc:-.25,co:.38,dl:0.15},
 {n:10,h:0.340,rho:.45,len:.54,wid:.28,tc:.21,to:1.00,cc:-.22,co:.34,dl:0.20},
 {n:9,h:0.425,rho:.43,len:.52,wid:.27,tc:.17,to:.88,cc:-.20,co:.28,dl:0.25},
 {n:9,h:0.510,rho:.40,len:.48,wid:.26,tc:.14,to:.76,cc:-.18,co:.22,dl:0.30},
 {n:8,h:0.595,rho:.35,len:.44,wid:.24,tc:.11,to:.64,cc:-.15,co:.18,dl:0.35},
 {n:7,h:0.680,rho:.29,len:.40,wid:.22,tc:.08,to:.52,cc:-.12,co:.14,dl:0.40},
 {n:6,h:0.765,rho:.22,len:.34,wid:.19,tc:.06,to:.42,cc:-.10,co:.12,dl:0.45},
 {n:8,h:0.850,rho:.14,len:.28,wid:.16,tc:.04,to:.34,cc:-.08,co:.10,dl:0.50}];
const FLOR=[[.48,.34,.92],[.48,.34,.92],[.48,.34,.92],[.78,.25,.70],[.30,.42,1.0],[1.0,.42,.54],[1.0,.60,.24]];
const TINT=[[1,1,1],[1,1,1],[1.12,.92,1.18],[.95,1.1,.95]];

function build(seed,{fl,dr,hero,hi}){
  const r=rng(seed),U={uBloom:{value:0},uCore:{value:0},uLit:{value:0},uTint:{value:new THREE.Vector3(1,1,1)},uFC:{value:new THREE.Vector3(.48,.34,.92)}};
  const Bs=[];let ph=r()*6.28;
  RINGS.forEach((Rg,ri)=>{ph+=.9;for(let i=0;i<Rg.n;i++)Bs.push([ph+i/Rg.n*6.2832+(r()-.5)*.28,Rg.h*(1+(r()-.5)*.05),Rg.rho,ri,
    Rg.len*(.9+r()*.2),Rg.wid*(.88+r()*.24),Rg.tc+(r()-.5)*.1,Rg.to+(r()-.5)*.25,Rg.cc+(r()-.5)*.1,Rg.co+(r()-.5)*.2,Rg.dl+(r()-.5)*.03,r()])});
  const N=Bs.length,a0=new Float32Array(N*4),a1=new Float32Array(N*4),a2=new Float32Array(N*4);
  Bs.forEach((b,i)=>{a0.set(b.slice(0,4),i*4);a1.set(b.slice(4,8),i*4);a2.set(b.slice(8,12),i*4)});
  const inst=(g,name,arr)=>g.setAttribute(name,new THREE.InstancedBufferAttribute(arr,4));
  const mk=base=>{const g=new THREE.InstancedBufferGeometry();g.index=base.index;g.setAttribute("position",base.attributes.position);g.setAttribute("normal",base.attributes.normal);return g};
  const grp=new THREE.Group();grp.rotation.order="YXZ";

  const bg=mk(hi?BASE_HI:BASE_LO);inst(bg,"aP0",a0);inst(bg,"aP1",a1);inst(bg,"aP2",a2);bg.instanceCount=N;
  const bm=new THREE.MeshPhysicalMaterial({color:0xffffff,roughness:.85,metalness:0,side:THREE.DoubleSide,envMapIntensity:.3});
  patch(bm,U,BR_F,BR_V);
  const bracts=new THREE.Mesh(bg,bm);bracts.frustumCulled=false;bracts.castShadow=hero;bracts.receiveShadow=true;
  if(hero){const dm=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,side:THREE.DoubleSide});patch(dm,U,null,DEPTH_V);bracts.customDepthMaterial=dm}
  grp.add(bracts);

  // florets on a Fermat spiral: short and pale in the middle, long and violet at the edge
  const f0=new Float32Array(fl*4),f1=new Float32Array(fl*4),f2=new Float32Array(fl*4),rMax=.26;
  for(let i=0;i<fl;i++){
    const rn=Math.sqrt((i+.5)/fl),a=i*2.39996,x=Math.cos(a),z=Math.sin(a),rd=r(),lean=.1+1.0*Math.pow(rn,1.2);
    const dir=new THREE.Vector3(x*lean,1,z*lean).normalize();
    f0.set([x*rMax*rn,.72+.1*(1-rn*rn),z*rMax*rn,(.1+.42*Math.pow(rn,.7))*(.82+.3*r())],i*4);
    f1.set([dir.x,dir.y,dir.z,.12+.2*r()],i*4);f2.set([rd,rn,0,0],i*4);
  }
  const fg=mk(hi?TUBE_HI:TUBE_LO);inst(fg,"aF0",f0);inst(fg,"aF1",f1);inst(fg,"aF2",f2);fg.instanceCount=fl;
  const fm=new THREE.MeshStandardMaterial({color:0xffffff,roughness:.85,side:THREE.DoubleSide,envMapIntensity:.25});
  patch(fm,U,F_F,F_V);
  const flor=new THREE.Mesh(fg,fm);flor.frustumCulled=false;flor.receiveShadow=true;grp.add(flor);

  const rec=new THREE.Mesh(new THREE.SphereGeometry(1,24,12),new THREE.MeshStandardMaterial({color:LIN(0x6e7a52),roughness:.9}));
  rec.scale.set(.30,.15,.30);rec.position.y=.7;rec.receiveShadow=true;grp.add(rec);
  const bulb=new THREE.Mesh(new THREE.SphereGeometry(1,20,12),new THREE.MeshStandardMaterial({color:LIN(0x1e2b1a),roughness:.9}));
  bulb.scale.set(.40,.36,.40);bulb.position.y=.08;bulb.castShadow=hero;grp.add(bulb);

  // dewdrops bound to bract (u,v) so they move with the petal
  const da=new Float32Array(dr*4),d0=new Float32Array(dr*4),d1=new Float32Array(dr*4),d2=new Float32Array(dr*4);
  for(let i=0;i<dr;i++){
    const bi=Math.floor(Math.pow(r(),1.5)*Bs.length*.82),b=Bs[bi];
    d0.set(b.slice(0,4),i*4);d1.set(b.slice(4,8),i*4);d2.set(b.slice(8,12),i*4);
    da.set([.14+.66*r(),(r()-.5)*1.3,.011+.032*Math.pow(r(),2.4),r()<.78?1:-1],i*4);
  }
  const dg=mk(SPH);inst(dg,"aP0",d0);inst(dg,"aP1",d1);inst(dg,"aP2",d2);inst(dg,"aD",da);dg.instanceCount=dr;
  const body=new THREE.MeshBasicMaterial({color:0x000000,transparent:true,opacity:.42,depthWrite:false});patch(body,U,null,D_V);
  const spec=new THREE.MeshPhysicalMaterial({color:0x000000,roughness:.12,metalness:0,transparent:true,blending:THREE.AdditiveBlending,depthWrite:false,envMapIntensity:2.5});patch(spec,U,null,D_V);
  for(const m of [body,spec]){const d=new THREE.Mesh(dg,m);d.frustumCulled=false;d.renderOrder=2;grp.add(d)}

  scene.add(grp);
  return{grp,U,hero,ph:r()*6.283,rot:r()*6.283,lean:(r()-.5)*.7,spd:.15+r()*.2,stage:r(),tr:0,lit:0,vis:0,d:1e9,lock:false,box:null,bb:[-9,-9,-9,-9],trail:[],cx:0,cy:0,bE:0,dress:[]};
}
/* stem + leaves, rebuilt whenever the layout changes (stem must reach the bottom of the screen) */
function dress(f,SL,seed){
  f.dress.forEach(o=>{f.grp.remove(o);if(o.userData.own)o.geometry.dispose()});f.dress=[];
  const r=rng(seed),dir=r()*6.28,amp=.1+.16*r();
  const pts=[0,.33,.66,1].map((p,i)=>new THREE.Vector3(Math.cos(dir)*amp*SL*Math.sin(p*3.14)*.6*(i?1:0),-p*SL,Math.sin(dir)*amp*SL*Math.sin(p*3.14)*.6*(i?1:0)));
  const {geo,curve}=stemGeo(pts,.075,.15,LOW?24:44,10);
  const st=new THREE.Mesh(geo,STEMMAT);st.userData.own=true;st.castShadow=f.hero;st.receiveShadow=true;f.grp.add(st);f.dress.push(st);
  const nl=f.hero?4:2+(r()*2|0);
  for(let k=0;k<nl;k++){
    const t=clamp(.05+(.1+.55*r())*Math.min(1,4/SL)),p=curve.getPoint(t),L=(f.hero?1.4:1.0)*(1.1+.9*r());
    const pv=new THREE.Group();pv.position.copy(p);pv.rotation.y=k*2.4+r()*1.2;
    const lf=new THREE.Mesh(LEAF,LEAFMAT);lf.scale.set(L*(.9+.3*r()),L,L);lf.castShadow=f.hero;lf.receiveShadow=true;pv.add(lf);
    f.grp.add(pv);f.dress.push(pv);
  }
}


/* ---------- the bee: honey-bee anatomy built from scratch (fuzzy thorax, banded abdomen, faceted eyes, veined wings, jointed legs) ---------- */
const bee=(function(){
  const g=new THREE.Group(),V=(x,y,z)=>new THREE.Vector3(x,y,z);
  const M=(c,r,extra)=>new THREE.MeshStandardMaterial(Object.assign({color:LIN(c),roughness:r,envMapIntensity:.45},extra||{}));
  const dark=M(0x1e140b,.55),brown=M(0x2c1c0e,.6);
  const sphere=new THREE.SphereGeometry(1,28,20);
  const part=(m,x,y,z,sx,sy,sz,par)=>{const o=new THREE.Mesh(sphere,m);o.position.set(x,y,z);o.scale.set(sx,sy,sz);(par||g).add(o);return o};

  // faceted compound-eye bump
  const eyeTex=(()=>{const c=document.createElement("canvas");c.width=c.height=128;const x=c.getContext("2d");x.fillStyle="#808080";x.fillRect(0,0,128,128);
    for(let j=0;j<18;j++)for(let i=0;i<18;i++){const cx=i*7+(j%2)*3.5,cy=j*6.2,gr=x.createRadialGradient(cx,cy,0,cx,cy,4.2);gr.addColorStop(0,"#fff");gr.addColorStop(1,"#222");x.fillStyle=gr;x.beginPath();x.arc(cx,cy,3.6,0,6.283);x.fill()}
    const tx=new THREE.CanvasTexture(c);tx.wrapS=tx.wrapT=THREE.RepeatWrapping;tx.repeat.set(2,2);return tx})();
  // wing membrane with venation (used as alpha map)
  const wingTex=(()=>{const c=document.createElement("canvas");c.width=256;c.height=128;const x=c.getContext("2d");x.fillStyle="#3a3a3a";x.fillRect(0,0,256,128);
    x.strokeStyle="#f2f2f2";x.lineCap="round";
    const L=(w,pts)=>{x.lineWidth=w;x.beginPath();x.moveTo(pts[0],pts[1]);for(let k=2;k<pts.length;k+=2)x.lineTo(pts[k],pts[k+1]);x.stroke()};
    L(3.2,[0,50,120,36,250,26]);L(2.4,[0,58,120,48,240,40]);L(2,[0,64,100,62,200,68,236,58]);L(1.8,[0,68,90,78,150,88,205,92]);L(1.6,[0,72,70,92,110,104]);
    [[60,54,70,66],[120,48,130,64],[170,40,180,62],[90,66,100,82],[150,76,160,92],[205,64,212,84],[40,60,46,74]].forEach(p=>L(1.2,p));
    const tx=new THREE.CanvasTexture(c);return tx})();

  // ----- fur: instanced hairs standing on an ellipsoid, swept backwards -----
  function fur(cx,cy,cz,ax,ay,az,count,len,cA,cB,bias,seed,keep){
    const r=rng(seed),geo=new THREE.ConeGeometry(.0065,1,5);geo.translate(0,.5,0);
    const m=new THREE.InstancedMesh(geo,new THREE.MeshStandardMaterial({roughness:.85,envMapIntensity:.35}),count);
    const o=new THREE.Object3D(),Y=V(0,1,0),c=new THREE.Color();let n=0,guard=0;
    while(n<count&&guard++<count*30){
      const d=V(r()*2-1,r()*2-1,r()*2-1);if(d.lengthSq()>1||d.lengthSq()<.05)continue;d.normalize();if(keep&&!keep(d))continue;
      const nrm=V(d.x/ax,d.y/ay,d.z/az).normalize(),dir=nrm.clone().multiplyScalar(.75).add(V(-bias,0,0)).add(V(r()-.5,r()-.5,r()-.5).multiplyScalar(.55)).normalize();
      o.position.set(cx+d.x*ax,cy+d.y*ay,cz+d.z*az).addScaledVector(nrm,-.012);o.quaternion.setFromUnitVectors(Y,dir);
      const Ls=len*(.7+.6*r());o.scale.set(1,Ls,1);o.updateMatrix();m.setMatrixAt(n,o.matrix);m.setColorAt(n,c.copy(cA).lerp(cB,r()));n++;
    }
    m.count=n;m.instanceMatrix.needsUpdate=true;if(m.instanceColor)m.instanceColor.needsUpdate=true;m.frustumCulled=false;g.add(m);return m;
  }
  const gold=LIN(0xd9a441),pale=LIN(0xe8c880),tan=LIN(0xa8741f);

  // ----- thorax + head -----
  part(brown,0,0,0,.34,.3,.31);
  fur(0,0,0,.34,.3,.31,1500,.085,gold,pale,.55,3);
  part(brown,.43,0,0,.17,.2,.2);
  fur(.43,0,0,.17,.2,.2,260,.05,pale,tan,.4,4);
  const eyeMat=new THREE.MeshPhysicalMaterial({color:LIN(0x1a1210),roughness:.25,metalness:0,bumpMap:eyeTex,bumpScale:.9,clearcoat:.7,clearcoatRoughness:.2,envMapIntensity:.9});
  [1,-1].forEach(s=>{const e=part(eyeMat,.45,.08,s*.145,.1,.14,.085);e.rotation.y=s*.3;part(dark,.58,.17,s*.05,.016,.016,.016)});
  part(dark,.56,.2,0,.018,.018,.018);
  const mand=new THREE.Mesh(new THREE.ConeGeometry(.04,.14,8),dark);mand.position.set(.6,-.1,0);mand.rotation.z=Math.PI/2+.5;g.add(mand);

  // ----- abdomen: lathe with overlapping tergites, honey bands over dark edges -----
  const AB=new THREE.Group();g.add(AB);
  (function(){
    const pts=[],N=48,Lb=1.0,cols=[];
    for(let k=0;k<=N;k++){const u=k/N,seg=u*5,f=seg%1,ridge=1-.07*(1-Math.pow(Math.max(0,Math.sin(Math.PI*f)),.4));
      pts.push(new THREE.Vector2(Math.max(.004,.275*Math.pow(Math.sin(Math.PI*Math.pow(u,.82)),.62))*ridge,u*Lb));}
    const geo=new THREE.LatheGeometry(pts,40);
    const amber=new THREE.Color(LIN(0xd18f16)),blk=new THREE.Color(LIN(0x1b1209)),c=new THREE.Color(),col=[];
    const pos=geo.attributes.position,np=pts.length;
    for(let v=0;v<pos.count;v++){const u=(v%np)/N,f=(u*5)%1;
      let mix=u<.1?.35:(u>.9?1:THREE.MathUtils.smoothstep(f,.5,.68));
      c.copy(amber).lerp(blk,mix);col.push(c.r,c.g,c.b)}
    geo.setAttribute("color",new THREE.Float32BufferAttribute(col,3));
    geo.rotateZ(Math.PI/2);geo.translate(-.2,0,0);
    const ab=new THREE.Mesh(geo,new THREE.MeshPhysicalMaterial({vertexColors:true,roughness:.42,clearcoat:.35,clearcoatRoughness:.35,envMapIntensity:.6}));AB.add(ab);
    const st=new THREE.Mesh(new THREE.ConeGeometry(.035,.2,8),dark);st.position.set(-1.28,0,0);st.rotation.z=Math.PI/2;AB.add(st);
  })();
  // short hairs along the abdomen, denser at the front
  fur(-.46,0,0,.3,.26,.26,240,.045,gold,tan,.6,5,d=>d.x<.3);
  fur(-.95,0,0,.3,.22,.22,150,.03,tan,gold,.6,6);

  // ----- antennae: scape + kinked flagellum -----
  const ants=[1,-1].map(s=>{
    const base=new THREE.Group();base.position.set(.56,.15,s*.07);base.rotation.set(s*.55,s*.15,-.5);g.add(base);
    const a1=new THREE.Mesh(new THREE.CylinderGeometry(.012,.016,.2,6).translate(0,.1,0),dark);base.add(a1);
    const k=new THREE.Group();k.position.y=.2;k.rotation.z=.9;base.add(k);
    const a2=new THREE.Mesh(new THREE.CylinderGeometry(.008,.012,.34,6).translate(0,.17,0),dark);k.add(a2);
    const tip=new THREE.Mesh(sphere,dark);tip.scale.setScalar(.014);tip.position.y=.34;k.add(tip);
    return{base,k,s}});

  // ----- legs: coxa-femur, tibia, tarsus; hind pair carries pollen baskets -----
  const legs=[];
  [[.22,.45,0],[.08,0,1],[-.08,-.45,2]].forEach(([x,swing,idx])=>[1,-1].forEach(s=>{
    const root=new THREE.Group();root.position.set(x,-.22,s*.1);root.rotation.set(-s*.38,0,swing*.7);g.add(root);
    const L1=.2+idx*.03,L2=.24+idx*.05;
    const fem=new THREE.Mesh(new THREE.CylinderGeometry(.022,.03,L1,7).translate(0,-L1/2,0),brown);root.add(fem);
    const j=new THREE.Group();j.position.y=-L1;j.rotation.set(s*.55,0,-.35*swing);root.add(j);
    const tib=new THREE.Mesh(new THREE.CylinderGeometry(.014,.024,L2,7).translate(0,-L2/2,0),brown);j.add(tib);
    if(idx===2){const bk=new THREE.Mesh(sphere,M(0xe39a1c,.8));bk.scale.set(.045,.12,.03);bk.position.set(0,-L2*.5,s*.02);j.add(bk)}
    const t=new THREE.Group();t.position.y=-L2;t.rotation.z=.35;j.add(t);
    t.add(new THREE.Mesh(new THREE.CylinderGeometry(.008,.012,.18,6).translate(0,-.09,0),dark));
    legs.push({root,s,idx,base:root.rotation.z,j});
  }));

  // ----- wings: 2 pairs, veined translucent membrane, faint ghost copies for beat blur -----
  function wingGeo(span,chord){
    const sh=new THREE.Shape();sh.moveTo(0,0);sh.bezierCurveTo(.2,.22,.7,.2,1,.05);sh.bezierCurveTo(.82,-.1,.3,-.14,0,0);
    const geo=new THREE.ShapeGeometry(sh,18),p=geo.attributes.position,uv=geo.attributes.uv;
    for(let k=0;k<p.count;k++){const x=p.getX(k),y=p.getY(k);uv.setXY(k,x,(y+.15)/.4);p.setXYZ(k,-y*chord,0,x*span)}
    geo.computeVertexNormals();return geo;
  }
  const wmat=(o)=>new THREE.MeshPhysicalMaterial({color:0xfff2d6,alphaMap:wingTex,transparent:true,opacity:o,roughness:.12,metalness:0,side:THREE.DoubleSide,depthWrite:false,envMapIntensity:1.2});
  const FW=wingGeo(.95,1.5),HW=wingGeo(.62,1.3),wings=[];
  [1,-1].forEach(s=>[[FW,.28,.0,0],[HW,.22,.26,.35]].forEach(([geo,y,zoff,ph])=>{
    const p=new THREE.Group();p.position.set(-.02-zoff*.05,y,s*.1);g.add(p);
    [[wmat(.55),0],[wmat(.12),.28],[wmat(.12),-.28]].forEach(([m,off])=>{const w=new THREE.Mesh(geo,m);w.rotation.x=off*s;w.scale.z=s;w.renderOrder=3;p.add(w)});
    wings.push({p,sd:s,ph})}));

  g.scale.setScalar(.42);g.visible=false;scene.add(g);
  return{g,wings,anim(t){
    if(RM)return;
    AB.rotation.z=Math.sin(t*.004)*.05;AB.scale.setScalar(1+Math.sin(t*.011)*.015);
    legs.forEach(l=>{l.root.rotation.z=l.base+Math.sin(t*.005+l.idx*1.3+l.s)*.1;l.j.rotation.x=l.s*(.55+Math.sin(t*.006+l.idx)*.12)});
    ants.forEach(a=>{a.base.rotation.x=a.s*(.55+Math.sin(t*.007+a.s)*.1);a.k.rotation.z=.9+Math.sin(t*.009+a.s*2)*.12});
  }};
})();
const BT=new THREE.Vector3(),BM=new THREE.Matrix4(),BX=new THREE.Vector3(),BY=new THREE.Vector3(),BZ2=new THREE.Vector3(),BUP=new THREE.Vector3(0,1,0);
function beeAt(u,tgt,out){
  const P0=new THREE.Vector3(-9.5,4.6,1.5),P1=new THREE.Vector3(-4.5,3.4,4.2),P2=new THREE.Vector3(tgt.x-3.2,tgt.y+2.6,tgt.z+2.2),a=1-u,b=u;
  out.set(0,0,0).addScaledVector(P0,a*a*a).addScaledVector(P1,3*a*a*b).addScaledVector(P2,3*a*b*b).addScaledVector(tgt,b*b*b);
  const w=a*a*.45*Math.sin(u*20);out.y+=w;out.z+=w*.7;return out;
}
function updateBee(t,p,tgt){
  if(p<.002){bee.g.visible=false;return}
  bee.g.visible=true;
  const pos=beeAt(p,tgt,new THREE.Vector3()),ahead=beeAt(Math.min(.985,p+.012),tgt,new THREE.Vector3());
  BT.copy(ahead).sub(beeAt(Math.min(.97,p),tgt,new THREE.Vector3()));
  if(BT.lengthSq()<1e-8)BT.copy(tgt).sub(pos);
  BX.copy(BT).normalize();BZ2.crossVectors(BX,BUP).normalize();BY.crossVectors(BZ2,BX);
  bee.g.quaternion.setFromRotationMatrix(BM.makeBasis(BX,BY,BZ2));
  bee.g.position.copy(pos);if(p>.97&&!RM)bee.g.position.y+=Math.sin(t*.02)*.012;
  bee.anim(t);
  bee.wings.forEach(w=>{const fl=RM?0:Math.sin(t*.09+w.ph*6);w.p.rotation.x=w.sd*(.15+.85*fl);w.p.rotation.y=w.sd*.22*(RM?0:Math.cos(t*.09+w.ph*6))});
}

/* ---------- scene state ---------- */
let W,H,DPR,camZ=8,hero,field=[],all=[],pairs=[],bgG,vigG,pollen=[],heroScroll=1,sp=0,bp=0,PPU0=1,XF=.5,HS0=2,HS1=1.5,HEROR=1,foliage=[],BEE0=.66;
const ptr={x:0,y:0,sx:0,sy:0,last:-1e9,real:false,trail:[]};
hero=build(11,{fl:LOW?700:2100,dr:100,hero:true,hi:true});hero.id=0;
const FIELD=Array.from({length:LOW?9:16},(_,i)=>build(100+i*13,{fl:LOW?200:340,dr:28,hero:false,hi:false}));
const SIDE=Array.from({length:LOW?5:10},(_,i)=>build(300+i*17,{fl:LOW?150:260,dr:14,hero:false,hi:false}));
SIDE.forEach(f=>{f.grp.visible=false;f.placed=false});
let FRONDS=[];
const HEROR_K=1.45;

/* artichoke plants and leaves that rise along both edges of the page while you read; buds open as they climb */
function layoutSide(FR){
  const r=rng(77);
  SIDE.forEach((f,i)=>{
    const left=i%2===0,z=-(.4+r()*3),ppu=H/(2*T2*(camZ-z)),rpx=FR*(.3+.2*r()),s=rpx/(ppu*HEROR_K);
    const edge=Math.min(.11,Math.max(.03,90/W))*(.4+.9*r());
    const m=3.4*rpx;
    Object.assign(f,{wz:z,s,rpx,px:left?W*(.02+edge):W*(.98-edge),m,span:H+2*m,k:.3+.45*r(),py0:(i/SIDE.length)*(H+2*m)+r()*80,leanS:left?-.28:.28,placed:true,rot:r()*6.28});
    f.U.uFC.value.set(...FLOR[Math.floor(r()*FLOR.length)]);f.U.uTint.value.set(...TINT[Math.floor(r()*TINT.length)]);
    dress(f,3.2,900+i*11);
    f.dress.forEach(o=>o.traverse(c=>{if(c.material===LEAFMAT)c.material=LEAFSIDE}));
  });
  FRONDS.forEach(l=>scene.remove(l.mesh));FRONDS=[];
  for(let k=0;k<(LOW?6:14);k++){
    const left=k%2===0,z=-(.2+r()*3.5),ppu=H/(2*T2*(camZ-z)),Lpx=110+140*r(),m=Lpx*1.4;
    const mesh=new THREE.Mesh(LEAF,LEAFSIDE);mesh.rotation.order="YXZ";mesh.receiveShadow=true;mesh.visible=false;scene.add(mesh);
    FRONDS.push({mesh,z,ppu,L:Lpx/ppu,px:left?W*(.012+.07*r()):W*(.988-.07*r()),m,span:H+2*m,k:.5+.9*r(),py0:r()*(H+2*m),ry:(left?1:-1)*(Math.PI/2+(r()-.5)*.5),ph:r()*6.28});
  }
}

function setup(){
  DPR=Math.min(2,devicePixelRatio||1);W=innerWidth;H=innerHeight;
  R.setPixelRatio(DPR);R.setSize(W,H,false);
  for(const c of [bgCv,fxc]){c.width=W*DPR;c.height=H*DPR}
  cam.aspect=W/H;camZ=Math.max(8,8.4/(W/H));cam.position.set(0,0,camZ);cam.updateProjectionMatrix();
  PPU0=H/(2*T2*camZ);
  const side=clamp((W/H-.9)/.6,0,1);XF=lerp(.5,.68,side);HS0=lerp(1.3,2.05,side);HS1=lerp(.9,1.5,side);
  HEROR=HEROR_K*HS1*PPU0;
  heroScroll=Math.max(1,document.getElementById("hero").offsetHeight-H);
  lastLine();
  bgG=bgc.createRadialGradient(W*.3,H*.15,0,W*.3,H*.15,Math.max(W,H));
  bgG.addColorStop(0,"#0a0f0c");bgG.addColorStop(.5,"#030504");bgG.addColorStop(1,"#010101");
  vigG=ctx.createRadialGradient(W/2,H/2,Math.min(W,H)*.35,W/2,H/2,Math.hypot(W,H)*.6);
  vigG.addColorStop(0,"rgba(0,0,0,0)");vigG.addColorStop(1,"rgba(0,0,0,.65)");
  pollen=Array.from({length:RM?0:60},(_,i)=>{const r=rng(i+99);return{x:r()*W,y:r()*H,v:.1+r()*.35,s:.6+r()*1.3,a:.1+r()*.3,p:r()*6}});
  hero.cx=XF*W;hero.cy=H/2;dress(hero,6,501);
  // field flowers: pack in screen space (away from the hero), then lift to world positions with stems down to the bottom edge
  const r=rng(7),n=clamp(Math.round(W*H/100000),8,FIELD.length),placed=[],FR=HEROR_K*PPU0;
  FIELD.forEach(f=>{f.grp.visible=false;f.placed=false});
  const stages=Array.from({length:n},(_,i)=>.03+.97*i/(n-1));
  for(let i=n-1;i>0;i--){const j=Math.floor(r()*(i+1));[stages[i],stages[j]]=[stages[j],stages[i]]}
  for(let tries=0;placed.length<n&&tries<5000;tries++){
    const rpx=FR*(.22+.38*Math.pow(r(),1.3)),cx=r()*W*1.04-W*.02,cy=H*.06+r()*H*.88;
    if(Math.hypot(cx-XF*W,cy-H/2)<HEROR*.88+rpx)continue;
    if(placed.some(o=>Math.hypot(cx-o.px,cy-o.py)<(rpx+o.rpx)*1.1))continue;
    const f=FIELD[placed.length],z=-(1.2+r()*4.5),ppu=H/(2*T2*(camZ-z)),s=rpx/(ppu*HEROR_K),pyb=cy+.4*rpx;
    Object.assign(f,{id:placed.length+1,px:cx,py:cy,rpx,wz:z,s,wx:(cx-W/2)/ppu,wy:-(pyb-H/2)/ppu,stage:stages[placed.length],
      t0:.58+Math.hypot(cx-W/2,cy-H/2)/Math.hypot(W,H)*.25,placed:true,cx,cy});
    f.U.uFC.value.set(...FLOR[Math.floor(r()*FLOR.length)]);f.U.uTint.value.set(...TINT[Math.floor(r()*TINT.length)]);
    dress(f,((H+90-pyb)/ppu)/s*1.15+.6,600+placed.length*7);
    placed.push(f);
  }
  field=placed.sort((a,b)=>a.s-b.s);all=[...field,hero];
  const set=new Set();
  all.forEach((f,i)=>{all.map((o,j)=>[j,Math.hypot(o.cx-f.cx,o.cy-f.cy)]).filter(q=>q[0]!==i).sort((a,b)=>a[1]-b[1]).slice(0,2).forEach(q=>set.add(Math.min(i,q[0])+"-"+Math.max(i,q[0])))});
  pairs=[...set].map(k=>k.split("-").map(Number));
  // foliage rising from the bottom edge, dark so the flowers stay the focus
  foliage.forEach(m=>scene.remove(m));foliage=[];
  const fr=rng(31),nf=LOW?8:16;
  for(let k=0;k<nf;k++){
    const z=-(fr()*5.5)+.3,ppu=H/(2*T2*(camZ-z)),L=1.4+2.2*fr(),m=new THREE.Mesh(LEAF,LEAFMAT);
    m.rotation.order="YXZ";m.rotation.set(-(.8+.5*fr()),fr()*6.28,0);m.scale.set(L*(.9+.3*fr()),L,L);
    m.position.set(((fr()*1.2-.1)*W-W/2)/ppu,-(H*1.0-H/2)/ppu-.15,z);m.castShadow=false;m.receiveShadow=true;
    scene.add(m);foliage.push(m);
  }
  layoutSide(FR);
}

/* ---------- tracking overlay helpers ---------- */
function brackets(x0,y0,x1,y1,c){
  ctx.beginPath();
  ctx.moveTo(x0,y0+c);ctx.lineTo(x0,y0);ctx.lineTo(x0+c,y0);
  ctx.moveTo(x1-c,y0);ctx.lineTo(x1,y0);ctx.lineTo(x1,y0+c);
  ctx.moveTo(x1,y1-c);ctx.lineTo(x1,y1);ctx.lineTo(x1-c,y1);
  ctx.moveTo(x0+c,y1);ctx.lineTo(x0,y1);ctx.lineTo(x0,y1-c);ctx.stroke();
}
function edge(b,tx,ty){
  const cx=(b[0]+b[2])/2,cy=(b[1]+b[3])/2,dx=tx-cx,dy=ty-cy;
  if(!dx&&!dy)return[cx,cy];
  const s=Math.min((b[2]-b[0])/2/Math.abs(dx||1e-9),(b[3]-b[1])/2/Math.abs(dy||1e-9),1);
  return[cx+dx*s,cy+dy*s];
}
function text(s,x,y,a){ctx.fillStyle=`rgba(255,255,255,${a})`;ctx.shadowColor="#000";ctx.shadowBlur=4;ctx.fillText(s,x,y);ctx.shadowBlur=0}
function link(p,q,a,t){
  ctx.strokeStyle=`rgba(255,255,255,${.6*a})`;ctx.lineWidth=1;ctx.setLineDash([5,5]);ctx.lineDashOffset=-(t*.02)%10;
  ctx.beginPath();ctx.moveTo(p[0],p[1]);ctx.lineTo(q[0],q[1]);ctx.stroke();ctx.setLineDash([]);
  ctx.fillStyle=`rgba(255,255,255,${.9*a})`;ctx.fillRect(p[0]-2.5,p[1]-2.5,5,5);ctx.fillRect(q[0]-2.5,q[1]-2.5,5,5);
  text(Math.round(Math.hypot(q[0]-p[0],q[1]-p[1]))+"px",(p[0]+q[0])/2+6,(p[1]+q[1])/2-6,.7*a);
}

const $=id=>document.getElementById(id);
const els={scroll:$("scroll"),intro:$("intro"),mark:$("hmark"),wm:$("hwm"),dot:$("hdot"),hint:$("hint"),words:[...document.querySelectorAll("#quote .w")]};
// brand sequence on the scroll timeline: logo while the bud is closed, then name, red dot, then the quote word by word
const fade=(e,v,y=16)=>{e.style.opacity=v;e.style.transform=`translateY(${(1-v)*y}px)`};
const V3=new THREE.Vector3(),V4=new THREE.Vector3();
function project(x,y,z){V3.set(x,y,z).project(cam);return[(V3.x*.5+.5)*W,(-V3.y*.5+.5)*H]}

// bee starts just before the quote's last line (depends on wrapping, so measured on resize / font load)
function lastLine(){const ws=[...document.querySelectorAll("#quote .w")];if(!ws.length)return;
  const top=ws[ws.length-1].offsetTop;BEE0=.31+.4*ws.findIndex(w=>w.offsetTop===top)/ws.length-.02}
document.fonts&&document.fonts.ready.then(lastLine);
// scroll -> timeline: brand fast, quote + bloom compressed, bee approach, then a long hold at
// full bloom (last 140vh of the 860vh hero scroll) so the finished scene stays in place
const TL=[[0,0],[.1442,.31],[.4651,.75],[.8372,1]];
function tl(r){for(let i=1;i<TL.length;i++){const[a,b]=TL[i-1],[c,d]=TL[i];if(r<=c)return b+(d-b)*(r-a)/(c-a)}return 1}
function frame(t){
  const target=tl(clamp(scrollY/heroScroll));
  const past=Math.max(0,scrollY-heroScroll);
  sp=RM||Math.abs(target-sp)<.0007?target:sp+(target-sp)*.06;
  const dim=lerp(1,.34,sstep(heroScroll*.995,heroScroll+H*.7,scrollY));
  els.scroll.style.opacity=1-sstep(.01,.08,sp);els.intro.style.opacity=1-sstep(.04,.2,sp);
  fade(els.mark,sstep(.02,.12,sp));fade(els.wm,sstep(.12,.22,sp));
  const dv=sstep(.24,.29,sp);els.dot.style.opacity=dv;els.dot.style.transform=`scale(${.2+.8*dv})`;
  const nw=els.words.length;els.words.forEach((w,i)=>{const a=.31+.4*i/nw;fade(w,sstep(a,a+.05,sp),8)});
  fade(els.hint,sstep(.88,.96,sp));

  const idle=t-ptr.last>2600;let tx=ptr.x,ty=ptr.y,live=ptr.real&&!idle;
  if(!live&&!RM&&sp>.85){tx=W*(.5+.36*Math.sin(t*.00023));ty=H*(.5+.3*Math.sin(t*.00031+1));live=true}
  if(live){ptr.sx+=(tx-ptr.sx)*.16;ptr.sy+=(ty-ptr.sy)*.16}
  const px=ptr.sx,py=ptr.sy,pdx=live?(px/W-.5):0,pdy=live?(py/H-.5):0;

  bgc.setTransform(DPR,0,0,DPR,0,0);bgc.globalAlpha=1;bgc.fillStyle=bgG;bgc.fillRect(0,0,W,H);
  for(const p of pollen){p.y-=p.v;p.x+=Math.sin(t*.0004+p.p)*.15;if(p.y<-5){p.y=H+5;p.x=Math.random()*W}
    bgc.fillStyle=`rgba(220,235,225,${p.a*dim})`;bgc.fillRect(p.x,p.y,p.s,p.s)}

  // raking key light swings slowly across the flowers
  const sw=RM?0:t*.0004;
  key.position.set(-5.5+3.2*Math.sin(sw),2.6+1.3*Math.cos(sw*.7),4.4);
  cam.position.x=-pdx*.5;cam.position.y=pdy*.3;cam.lookAt(0,0,0);

  // hero: seen from the side, partly facing the screen, large and on the right
  const hb=sstep(0,.72,sp),zo=sstep(.7,1,sp),hs=lerp(HS0,HS1,zo);
  hero.bE=hb;hero.U.uBloom.value=hero.bE;hero.U.uLit.value=hero.lit;hero.U.uCore.value=sstep(.45,.7,hb);// centre rings fold away while the florets emerge, never rising out of them
  hero.grp.scale.setScalar(hs);
  hero.grp.rotation.set(lerp(.12,.7,sstep(0,1,hero.bE)),-1.0+sp*.35+(RM?0:Math.sin(t*.0003)*.12),0);
  hero.grp.position.set(0,0,0);hero.grp.updateMatrixWorld(true);
  const hc=hero.grp.localToWorld(V4.set(0,.55,0)).clone();
  hero.grp.position.set((XF-.5)*W/PPU0-hc.x,-hc.y+past*.85/PPU0,-hc.z);
  hero.grp.visible=past<H*1.7;
  key.target.position.set((XF-.5)*W/PPU0,0,0);
  hero.vis=sstep(.72,.85,sp);
  const bt=sstep(BEE0,.99,sp);bp=RM||Math.abs(bt-bp)<.001?bt:bp+(bt-bp)*.03;// bee glides behind the scroll
  updateBee(t,past>H*1.7?0:bp,hero.grp.localToWorld(V4.set(0,.9,0)).clone());
  for(const f of field){
    const ap=sstep(f.t0,f.t0+.15,sp);f.vis=ap;f.grp.visible=ap>.003&&past<H*1.7;
    if(!f.grp.visible){f.bb=[-9,-9,-9,-9];continue}
    const bl=clamp((RM?f.stage:sstep(0,1,.5+.62*Math.sin(t*.001*f.spd+f.ph))));
    f.bE=bl;f.U.uBloom.value=bl;f.U.uLit.value=f.lit;
    f.grp.scale.setScalar(f.s*Math.pow(ap,.7));
    // natural growth: still upright overall, each head leaning its own way and swaying
    f.grp.rotation.set(.28+.4*sstep(0,1,bl),f.rot+(RM?0:Math.sin(t*.0002+f.ph)*.25),f.lean+(RM?0:Math.sin(t*.0006+f.ph)*.05));
    f.grp.position.set(f.wx-pdx*.5*(f.s+.3),f.wy-(1-ap)*.8+past*.85*(2*T2*(camZ-f.wz))/H,f.wz);
  }
  for(const f of all){
    if(f!==hero&&!f.grp.visible)continue;
    f.grp.updateMatrixWorld(true);
    const s=f.grp.scale.x,c=f.grp.localToWorld(V4.set(0,.55,0)).clone();
    const pc=project(c.x,c.y,c.z),ppu=H/(2*T2*(camZ-c.z)),rp=s*(.55+.95*sstep(0,1,f.bE))*ppu;
    f.cx=pc[0];f.cy=pc[1];f.bb=[pc[0]-rp,pc[1]-rp*1.05,pc[0]+rp,pc[1]+rp*1.05];
  }
  // side garden: climbs along the page edges as you scroll, buds opening on the way up
  const gp=sstep(heroScroll*.9,heroScroll+H*.4,scrollY);
  for(const f of SIDE){
    f.grp.visible=gp>.01&&f.placed;if(!f.grp.visible)continue;
    const ppu=H/(2*T2*(camZ-f.wz)),yPx=(((f.py0-past*f.k)%f.span)+f.span)%f.span-f.m,u=clamp(1-yPx/H);
    const bl=clamp(sstep(.12,.8,u)+(RM?0:Math.sin(t*.0007+f.ph)*.06));
    f.bE=bl;f.U.uBloom.value=bl;f.U.uLit.value=.8;
    f.grp.scale.setScalar(f.s*gp);
    f.grp.rotation.set(.25+.35*bl,f.rot+(RM?0:Math.sin(t*.0003+f.ph)*.3),f.leanS+(RM?0:Math.sin(t*.0008+f.ph)*.07));
    f.grp.position.set((f.px-W/2)/ppu,-(yPx+.4*f.rpx-H/2)/ppu,f.wz);
  }
  for(const l of FRONDS){
    l.mesh.visible=gp>.01;if(!l.mesh.visible)continue;
    const yPx=(((l.py0-past*l.k)%l.span)+l.span)%l.span-l.m,u=clamp(1-yPx/H),unf=sstep(.05,.7,u);
    l.mesh.rotation.set(-(.35+.9*unf)+(RM?0:Math.sin(t*.0009+l.ph)*.1),l.ry+(RM?0:Math.sin(t*.0005+l.ph)*.18),RM?0:Math.sin(t*.0007+l.ph)*.06);
    l.mesh.scale.set(l.L*(.45+.55*unf)*gp*.9,l.L*(.45+.55*unf)*gp,l.L*(.45+.55*unf)*gp);
    l.mesh.position.set((l.px-W/2)/l.ppu,-(yPx-H/2)/l.ppu,l.z);
  }
  glCv.style.opacity=1;
  R.render(scene,cam);

  // ---- 2D overlay: network, vignette, blob tracking ----
  ctx.setTransform(DPR,0,0,DPR,0,0);ctx.clearRect(0,0,W,H);
  const fieldVis=sp>.6&&past<H*.6;
  if(fieldVis){
    ctx.lineWidth=1;
    for(const[i,j]of pairs){const a=all[i],b=all[j],v=Math.min(a.vis,b.vis)*dim;if(v<.02)continue;
      ctx.strokeStyle=`rgba(255,255,255,${.07*v})`;ctx.beginPath();ctx.moveTo(a.cx,a.cy);ctx.lineTo(b.cx,b.cy);ctx.stroke()}
  }
  ctx.globalAlpha=1-.9*gp;ctx.fillStyle=vigG;ctx.fillRect(0,0,W,H);ctx.globalAlpha=1;

  const INF=Math.min(W,H)*.2,cand=[];
  if(fieldVis&&live){for(const f of all){if(f.vis<.6)continue;const b=f.bb;
    const dx=Math.max(b[0]-px,0,px-b[2]),dy=Math.max(b[1]-py,0,py-b[3]);f.d=Math.hypot(dx,dy);if(f.d<INF)cand.push(f)}}
  cand.sort((a,b)=>a.d-b.d);const tracked=cand.slice(0,5);
  for(const f of all){
    const k=tracked.indexOf(f),tg=k<0?0:(f.d<2?1:.35+.5*(1-f.d/INF));
    f.tr+=(tg-f.tr)*(tg>f.tr?.14:.07);f.lit=f.tr*f.tr;
  }
  ctx.font=MONO;ctx.textBaseline="alphabetic";ctx.lineCap="butt";
  tracked.forEach((a,i)=>{for(let j=i+1;j<tracked.length&&j<=i+2;j++){
    const b=tracked[j],ca=[(a.bb[0]+a.bb[2])/2,(a.bb[1]+a.bb[3])/2],cb=[(b.bb[0]+b.bb[2])/2,(b.bb[1]+b.bb[3])/2];
    link(edge(a.box||a.bb,cb[0],cb[1]),edge(b.box||b.bb,ca[0],ca[1]),Math.min(a.tr,b.tr),t)}});
  if(tracked.length)link([px,py],edge(tracked[0].box||tracked[0].bb,px,py),tracked[0].tr,t);
  for(const f of all){
    if(f.tr<.02)continue;
    const p=10,tb=[f.bb[0]-p,f.bb[1]-p,f.bb[2]+p,f.bb[3]+p];
    f.box=f.box||tb.slice();for(let i=0;i<4;i++)f.box[i]+=(tb[i]-f.box[i])*.25;
    const[a,b,c,d]=f.box,hov=f.d<2,al=.9*f.tr,cx=(a+c)/2,cy=(b+d)/2;
    f.trail.push([cx,cy]);if(f.trail.length>18)f.trail.shift();
    ctx.lineWidth=hov?1.6:1;ctx.strokeStyle=`rgba(255,255,255,${al})`;
    brackets(a,b,c,d,Math.min(20,(c-a)*.2));
    ctx.beginPath();ctx.moveTo(cx-5,cy);ctx.lineTo(cx+5,cy);ctx.moveTo(cx,cy-5);ctx.lineTo(cx,cy+5);ctx.stroke();
    ctx.strokeStyle=`rgba(255,255,255,${.35*f.tr})`;ctx.beginPath();f.trail.forEach((q,i)=>i?ctx.lineTo(q[0],q[1]):ctx.moveTo(q[0],q[1]));ctx.stroke();
    text("ID "+String(f.id).padStart(2,"0")+(hov?"  LOCK":""),a,b-18,al);
    text("x:"+Math.round(cx)+" y:"+Math.round(cy)+" bloom:"+Math.round(f.bE*100)+"%",a,b-5,al*.8);
  }
  if(live&&sp>.02&&past<H*.6){
    ptr.trail.push([px,py]);if(ptr.trail.length>28)ptr.trail.shift();
    ctx.lineWidth=1;
    ptr.trail.forEach((q,i)=>{if(!i)return;ctx.strokeStyle=`rgba(255,255,255,${i/ptr.trail.length*.5})`;ctx.beginPath();ctx.moveTo(ptr.trail[i-1][0],ptr.trail[i-1][1]);ctx.lineTo(q[0],q[1]);ctx.stroke()});
    const s=tracked.length&&tracked[0].d<2?11:17;
    ctx.save();ctx.beginPath();ctx.arc(px,py,Math.min(W,H)*.2,0,6.283);ctx.clip();
    ctx.strokeStyle="rgba(255,255,255,.05)";ctx.beginPath();
    for(let gx=Math.floor((px-300)/48)*48;gx<px+300;gx+=48){ctx.moveTo(gx,py-300);ctx.lineTo(gx,py+300)}
    for(let gy=Math.floor((py-300)/48)*48;gy<py+300;gy+=48){ctx.moveTo(px-300,gy);ctx.lineTo(px+300,gy)}
    ctx.stroke();ctx.restore();
    ctx.strokeStyle="#fff";ctx.lineWidth=1.5;brackets(px-s,py-s,px+s,py+s,6);
    text("x:"+Math.round(px)+" y:"+Math.round(py),px+s+8,py+s+12,.85);
  }
  requestAnimationFrame(frame);
}

const mv=e=>{ptr.x=e.clientX;ptr.y=e.clientY;if(!ptr.real){ptr.sx=ptr.x;ptr.sy=ptr.y}ptr.real=true;ptr.last=performance.now()};
addEventListener("pointermove",mv);addEventListener("pointerdown",mv);
addEventListener("pointerup",()=>{ptr.last=performance.now()});
addEventListener("resize",setup);
setup();requestAnimationFrame(frame);
