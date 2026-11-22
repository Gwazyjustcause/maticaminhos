import {mkdir,copyFile} from 'node:fs/promises';
const output=new URL('./dist/',import.meta.url);
await mkdir(output,{recursive:true});
for(const name of ['index.html','style.css','app.js','optimizer.mjs','costs.mjs','routing.mjs','search.mjs','tolls.mjs','toll-data.json']) {
  await copyFile(new URL(name,import.meta.url),new URL(name,output));
}
console.log('Static site built in dist/');
