"use strict";(self.webpackChunk_N_E=self.webpackChunk_N_E||[]).push([[990],{85:function(e,t,a){a.r(t),a.d(t,{default:function(){return o}});var r=a(5893),i=a(7294);a(258);var n=a(8496);function l(e){var t;let{modelUrl:a,environmentImageUrl:l,showEnvironment:o=!1,exposure:u=1,animationName:s,animationPaused:d=!1,cameraOrbit:f,cameraTarget:c,fieldOfView:m,children:v}=e,[h,g]=(0,i.useState)(null),[x,E]=(0,i.useState)(!1),b=(0,i.useMemo)(()=>h&&x&&h.model?{modelViewer:h,model:h.model,isLoaded:x}:null,[h,x]);return t=h,(0,i.useEffect)(()=>{t&&(t.timeScale=.5)},[t]),(0,i.useEffect)(()=>{if(!h)return;let e=!1,t=()=>{e||E(!0)};return h.addEventListener("load",t),()=>{e=!0,h.removeEventListener("load",t)}},[h,a]),(0,i.useEffect)(()=>{h&&h.loaded&&E(!0)},[h,a]),(0,i.useEffect)(()=>{h&&x&&(d?h.pause():h.play())},[h,x,d]),(0,i.useEffect)(()=>{h&&x&&m&&h.setAttribute("field-of-view",m)},[h,x,m]),(0,r.jsxs)(r.Fragment,{children:[(0,r.jsx)("model-viewer",{ref:g,alt:"Tribes 2 Model",src:a,"camera-controls":!0,"camera-orbit":f,"max-camera-orbit":l&&o?"auto 90deg auto":void 0,"camera-target":c,"min-field-of-view":"10deg","max-field-of-view":"45deg","animation-name":null!=s?s:void 0,autoplay:s?"true":"false","touch-action":"pan-y",exposure:u,"environment-image":null!=l?l:void 0,"skybox-image":l&&o?l:void 0,"skybox-height":"1.5m","shadow-intensity":l&&o?1:0,style:{width:"100%",height:"100%"}}),x?(0,r.jsx)(n.K.Provider,{value:b,children:v}):null]})}function o(e){return(0,r.jsx)(l,{...e},e.modelUrl)}}}]);
//# sourceMappingURL=990.4c85486f75efa465.js.map