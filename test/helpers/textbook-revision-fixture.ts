import { mkdir, writeFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { syntheticSemanticBundle, syntheticHash, writeSyntheticBundle, OLD_PDF_SHA, NEW_PDF_SHA } from './semantic-source-fixture';
export { OLD_PDF_SHA, NEW_PDF_SHA };
export async function writeSyntheticRevision(root: string, revision: string, pages: number) {
 const dir=join(root,revision),bundle=syntheticSemanticBundle(revision,pages);
 await writeSyntheticBundle(dir,bundle);
 await rename(join(dir,'private-textbook-semantic-data'),join(dir,'semantic'));
 const raw=join(dir,'raw');for(const folder of ['pages','renders'])await mkdir(join(raw,folder),{recursive:true});
 const entries=[];
 for(let page=1;page<=pages;page++){
  const stem='page-'+String(page).padStart(3,'0'),data={schemaVersion:'hanq-raw/1',sourceSha256:revision,pdfPage:page,printedPage:null,width:100,height:100,textBlocks:[],text:'SYNTHETIC REVISION TEST',imagePath:`renders/${stem}.png`};
  const bytes=JSON.stringify(data);await writeFile(join(raw,`pages/${stem}.json`),bytes);await writeFile(join(raw,`renders/${stem}.png`),bundle.figure);
  entries.push({pdfPage:page,printedPage:null,width:100,height:100,dataPath:`pages/${stem}.json`,imagePath:`renders/${stem}.png`,dataSha256:syntheticHash(bytes),imageSha256:syntheticHash(bundle.figure)});
 }
 const manifest={schemaVersion:'hanq-raw/1',source:{sha256:revision,pageCount:pages,bytes:100},pages:entries};await writeFile(join(raw,'manifest.json'),JSON.stringify(manifest));
 return {dir,raw,semantic:join(dir,'semantic'),bundle,manifest};
}
