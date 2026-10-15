import test from 'node:test';
import assert from 'node:assert/strict';
import {parseFiestaShares,galleryRetentionDays} from '../shared/fiesta-gallery.js';
import {validateGalleryImage} from '../server/src/services/gallery-policy.js';
const header='Shared via,Email Address,Phone Number,Content Link,File Name,Share Time\r\n';
const row='E-mail,guest@example.invalid,,https://boothpics.com/QA1/capture1,PHOTO1.jpeg,2026-09-28 16:36 PST';
test('Fiesta mappings preserve recipients, deduplicate replays and reject cross-event/conflicting identities',()=>{
 const csv=header+row+'\r\n'+row+'\r\nPhone number,,17735550123,https://boothpics.com/QA1/capture1,PHOTO1.jpeg,2026-09-28 16:36 PST';
 const parsed=parseFiestaShares(csv,'QA1');assert.equal(parsed.sharingRows,3);assert.equal(parsed.records.length,2);assert.equal(parsed.captures,1);assert.equal(parsed.records[1].recipient,'+17735550123');
 assert.throws(()=>parseFiestaShares(csv,'OTHER'));
 assert.throws(()=>parseFiestaShares(header+row+'\n'+row.replace('capture1','capture2')));
 assert.throws(()=>parseFiestaShares(header+row.replace('boothpics.com','localhost')));
 assert.throws(()=>parseFiestaShares(header+row.replace('PHOTO1.jpeg','../PHOTO1.jpeg')));
 assert.throws(()=>parseFiestaShares(header+row.replace('guest@example.invalid','')));
 assert.throws(()=>parseFiestaShares(header+row.replace('E-mail','Other')));
 assert.throws(()=>parseFiestaShares(header+row+'\n"unterminated'));
 assert.equal(parseFiestaShares(header+row.replace('E-mail','"E-mail"')).records.length,1);
});
test('Gallery periods use longest recognized package; custom tier needs explicit agreement',()=>{
 assert.equal(galleryRetentionDays(['The Essential']),30);assert.equal(galleryRetentionDays(['The Signature']),60);assert.equal(galleryRetentionDays(['Essential','The Luxe']),90);assert.equal(galleryRetentionDays(['Custom']),null);assert.equal(galleryRetentionDays([]),null);
});
test('Video container validation accepts bounded MP4 and rejects mislabeled input',()=>{
 const bytes=Buffer.alloc(32);bytes.writeUInt32BE(32);bytes.write('ftyp',4);bytes.write('isom',8);validateGalleryImage(bytes,'video/mp4');
 assert.throws(()=>validateGalleryImage(Buffer.from('<script>not video</script>'),'video/mp4'));assert.throws(()=>validateGalleryImage(Buffer.alloc(11*1024*1024),'video/mp4'));
});
