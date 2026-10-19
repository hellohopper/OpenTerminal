import type {MetadataRoute} from 'next';
export default function manifest():MetadataRoute.Manifest{return {id:'/',name:'OpenTerminal',short_name:'OpenTerminal',description:'Personal market research terminal',start_url:'/',display:'standalone',background_color:'#080b10',theme_color:'#111827',icons:[{src:'/icon.svg',sizes:'any',type:'image/svg+xml',purpose:'any'}]};}
