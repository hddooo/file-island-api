import {AppError} from '../common/app-error';
export const IMAGE_LIMIT=8*1024*1024,AUDIO_LIMIT=16*1024*1024;
export const ASSET_PURPOSES=['source_image','clean_image','audio'];
export function validateMedia(bytes:Buffer,mediaType:string,purpose:string){
 if(!ASSET_PURPOSES.includes(purpose))throw new AppError(400,'invalid_asset_purpose','Invalid asset purpose');
 const audio=purpose==='audio',limit=audio?AUDIO_LIMIT:IMAGE_LIMIT;
 if(!bytes.length||bytes.length>limit)throw new AppError(413,'asset_too_large','Asset size exceeds limit');
 const head=bytes.subarray(0,12),ascii=head.toString('ascii');
 const png=bytes.length>=24&&head.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))&&bytes.readUInt32BE(16)>0&&bytes.readUInt32BE(20)>0&&bytes.readUInt32BE(16)<=20000&&bytes.readUInt32BE(20)<=20000&&bytes.readUInt32BE(16)*bytes.readUInt32BE(20)<=40000000;
 const jpeg=bytes.length>=4&&bytes[0]===255&&bytes[1]===216&&bytes[2]===255&&bytes[bytes.length-2]===255&&bytes[bytes.length-1]===217;
 const webp=bytes.length>=20&&ascii.startsWith('RIFF')&&ascii.slice(8)==='WEBP'&&bytes.readUInt32LE(4)+8===bytes.length;
 const mp3=bytes.length>=10&&(ascii.startsWith('ID3')||(bytes[0]===255&&(bytes[1]&224)===224));
 const wav=bytes.length>=44&&ascii.startsWith('RIFF')&&ascii.slice(8)==='WAVE';
 const valid=audio?(mediaType==='audio/mpeg'&&mp3)||(mediaType==='audio/wav'&&wav):(mediaType==='image/png'&&png)||(mediaType==='image/jpeg'&&jpeg)||(mediaType==='image/webp'&&webp);
 if(!valid)throw new AppError(400,'invalid_asset_type','Unsupported media or invalid signature');
 return{mediaType,limit};
}
