import crypto from 'node:crypto';
import {galleryStorage} from './gallery-storage.js';
import {AppError} from '../utils/errors.js';
export async function verifiedGalleryBytes(media,revalidate=async()=>{}){
 const storage=galleryStorage();if(storage.provider!==media.storage_provider)throw new AppError('Gallery storage unavailable.',503,'GALLERY_STORAGE_NOT_READY');
 const source=await storage.get(media.storage_key),chunks=[];let size=0;
 for await(const chunk of source){size+=chunk.length;if(size>10*1024*1024)throw new AppError('Capture exceeds the supported size.',503,'GALLERY_MEDIA_INTEGRITY');chunks.push(chunk);}
 const bytes=Buffer.concat(chunks);
 if(size!==Number(media.size_bytes)||crypto.createHash('sha256').update(bytes).digest('hex')!==media.checksum)throw new AppError('Capture could not be verified.',503,'GALLERY_MEDIA_INTEGRITY');
 await revalidate();return bytes;
}
