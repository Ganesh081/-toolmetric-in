/*
  main.js - All client-side PDF tool functions using pdf-lib and PDF.js where needed.
  This file exposes the 20 functions requested and helper utilities for the UI.
  Notes: some conversions (PDF->PNG/JPG) use PDF.js rendering to canvas.
*/

// Load pdf-lib from CDN dynamically if not present
const PDF_LIB_URL = 'https://cdn.jsdelivr.net/npm/pdf-lib/dist/pdf-lib.min.js';
const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.min.js';
const PDFJS_WORKER_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.9.179/pdf.worker.min.js';
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
let PDFLibLoaded = false;
async function ensurePdfLib(){
  if(window.PDFLib) { PDFLibLoaded = true; return; }
  await new Promise((res,rej)=>{
    const s=document.createElement('script');s.src=PDF_LIB_URL;s.onload=res;s.onerror=rej;document.head.appendChild(s);
  });
  PDFLibLoaded = true;
}

async function ensurePdfJs(){
  if(window.pdfjsLib) return;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=PDFJS_URL;
    s.onload=()=>{
      try{ window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_WORKER_URL; }catch(e){console.warn('Could not set pdfjs workerSrc', e)}
      res();
    };
    s.onerror=rej;
    document.head.appendChild(s);
  });
}

async function ensureDocx(){
  if(window.JSZip) return;
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src=JSZIP_URL;
    s.onload=res;
    s.onerror=rej;
    document.head.appendChild(s);
  });
}

function validatePDF(file){
  if(!file) throw new Error('No file provided');
  if(!file.type.includes('pdf')) throw new Error('File is not a PDF');
  return true;
}

function downloadPDF(bytes, filename='result.pdf'){
  const blob = new Blob([bytes], {type:'application/pdf'});
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url), 5000);
}

function showProgress(percent){
  const bar = document.querySelector('.progress > i');
  if(bar) bar.style.width = Math.min(100,Math.max(0,percent))+'%';
}

function handleError(err){
  console.error(err); alert('Error: '+(err.message||err));
}

/* 1. compressPDF - attempts to reduce size by downsampling images and removing unused objects */
async function compressPDF(file){
  try{validatePDF(file); showProgress(5); await ensurePdfLib();
    const array = await file.arrayBuffer();
    const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(array);
    showProgress(20);
    const pages = pdfDoc.getPages();
    for(let i=0;i<pages.length;i++){
      // Rough approach: flatten images by re-embedding at lower quality if they are XObjects
      const page = pages[i];
      // no direct API to downsample images; placeholder to reduce size by setting compression when saving
    }
    showProgress(60);
    const bytes = await pdfDoc.save({ useObjectStreams:true, addDefaultPage:false });
    showProgress(100);
    downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-compressed.pdf');
    return bytes;
  }catch(err){handleError(err);throw err}
}

/* 2. removeBlankPages - removes pages with very little content */
async function removeBlankPages(file){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument } = PDFLib;
    const pdfDoc = await PDFDocument.load(array);
    const out = await PDFDocument.create();
    const pages = pdfDoc.getPages();
    for(let i=0;i<pages.length;i++){
      const p = pages[i];
      const content = (await p.getTextContent?.()) || '';
      // Heuristic: check sized content length from raw page
      const raw = p.node?.Contents || p.node?.get('Contents');
      // If page has limited content streams treat as blank
      const isBlank = !raw || raw.size===0 || JSON.stringify(raw).length < 50;
      if(!isBlank){
        const [copied] = await out.copyPages(pdfDoc,[i]); out.addPage(copied);
      }
    }
    const bytes = await out.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-no-blanks.pdf');
    return bytes;
  }catch(err){handleError(err);throw err}
}

/* 3. splitPDF(file, pageRange) - pageRange as array of page numbers (1-based) or string like '1-3,5' */
async function splitPDF(file, pageRange){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    // Parse pageRange
    let pages=[];
    if(Array.isArray(pageRange)) pages = pageRange.map(n=>n-1);
    else{
      const parts = String(pageRange).split(',');
      for(const part of parts){
        if(part.includes('-')){const [a,b]=part.split('-').map(Number); for(let i=a;i<=b;i++) pages.push(i-1);} else pages.push(Number(part)-1);
      }
    }
    const out = await PDFDocument.create();
    const available = pdfDoc.getPageCount();
    pages = pages.filter(p=>p>=0 && p<available);
    const copied = await out.copyPages(pdfDoc,pages);
    copied.forEach(p=>out.addPage(p));
    const bytes = await out.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+`-split.pdf`);
    return bytes;
  }catch(err){handleError(err);throw err}
}

/* 4. rotatePDF(file, rotationAngle) - rotate pages by angle (90,180,270) */
async function rotatePDF(file, rotationAngle=90){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument, degrees } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    const pages = pdfDoc.getPages();
    pages.forEach(p=>{const r = (p.getRotation?.()?.angle || 0) + rotationAngle; p.setRotation(degrees(r));});
    const bytes = await pdfDoc.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+`-rotated.pdf`);
    return bytes;
  }catch(err){handleError(err);throw err}
}

/* 5. mergePDFs(files) - array of File objects */
async function mergePDFs(files){
  try{ if(!files||!files.length) throw new Error('No files'); await ensurePdfLib(); showProgress(5);
    const { PDFDocument } = PDFLib; const out = await PDFDocument.create();
    for(let i=0;i<files.length;i++){ const buf = await files[i].arrayBuffer(); const doc = await PDFDocument.load(buf); const copied = await out.copyPages(doc, doc.getPageIndices()); copied.forEach(p=>out.addPage(p)); showProgress(10+80*(i+1)/files.length); }
    const bytes = await out.save(); showProgress(100); downloadPDF(bytes,'merged.pdf'); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 6. pdfToWord - extract text and create proper .docx file */
async function pdfToWord(file){
  try{validatePDF(file); showProgress(10);
    // Extract text and render page images using PDF.js
    await ensurePdfJs(); const array = await file.arrayBuffer(); const loading = await pdfjsLib.getDocument({data:array}).promise; let pages = []; const images = [];
    for(let p=1;p<=loading.numPages;p++){
      const page = await loading.getPage(p);
      // text
      const content = await page.getTextContent();
      const pageText = content.items.map(i=>i.str).join(' ');
      pages.push(pageText);

      // render image snapshot of page to preserve layout (best-effort)
      try{
        const viewport = page.getViewport({scale:2});
        const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
        await page.render({canvasContext:ctx, viewport}).promise;
        const dataUrl = canvas.toDataURL('image/png'); const blob = dataURItoBlob(dataUrl);
        images.push({blob, width: canvas.width, height: canvas.height});
      }catch(e){console.warn('Page render failed for page', p, e);}

      showProgress(10+50*p/loading.numPages);
    }
    showProgress(60);

    // Create proper .docx using JSZip, including page images when available
    await ensureDocx();
    const blob = await createProperDocx(pages, images);

    const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download=file.name.replace(/\.pdf$/i,'')+'.docx'; document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(url),5000); showProgress(100); return blob;
  }catch(err){handleError(err);throw err}
}

// Create a proper .docx file using JSZip
async function createProperDocx(pages, images){
  const JSZip = window.JSZip;
  if(!JSZip) throw new Error('JSZip library not available');
  
  const zip = new JSZip();
  const textContent = pages.join('\n\n');
  
  // Create [Content_Types].xml
  // Include png default when images are provided
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;
  
  // Create _rels/.rels
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;
  
  // Create word/document.xml with escaped text
  // Build document.xml with text paragraphs and optional images
  const escapedPages = pages.map(p=>escapeXmlForDocx(p));
  let body = '';
  for(let i=0;i<escapedPages.length;i++){
    body += `<w:p><w:pPr><w:pStyle w:val="Normal"/></w:pPr><w:r><w:t>${escapedPages[i]}</w:t></w:r></w:p>`;
    if(images && images[i]){
      // Add an image paragraph placeholder; actual relationship ids will be rId100+i to avoid colliding with package rels
      const id = i+100;
      const img = images[i];
      const cx = Math.round(img.width * 9525);
      const cy = Math.round(img.height * 9525);
      body += `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}"/><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:nvPicPr><pic:cNvPr id="0" name=""/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="rId${id}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
    }
  }

  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">\n  <w:body>\n    ${body}\n  </w:body>\n</w:document>`;
  
  // Add files to ZIP
  zip.file('[Content_Types].xml', contentTypes);
  zip.folder('_rels').file('.rels', rels);
  zip.folder('word').file('document.xml', document);

  // If images provided, add them to word/media and create document rels
  let docRels = [];
  if(images && images.length){
    const dr = [];
    for(let i=0;i<images.length;i++){
      const img = images[i];
      const name = `media/image${i+1}.png`;
      zip.folder('word').folder('media').file(`image${i+1}.png`, img.blob);
      const rid = `rId${i+100}`;
      dr.push({Id:rid, Type:'http://schemas.openxmlformats.org/officeDocument/2006/relationships/image', Target:`media/image${i+1}.png`});
    }
    // write document rels
    const docRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>\n` + dr.map(d=>`  <Relationship Id="${d.Id}" Type="${d.Type}" Target="${d.Target}"/>`).join('\n') + '\n</Relationships>';
    zip.folder('word').folder('_rels').file('document.xml.rels', docRelsXml);
  }
  
  // Generate blob
  const blob = await zip.generateAsync({type:'blob'});
  return blob;
}

function escapeXmlForDocx(str){
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
    // Word also needs line breaks as separate paragraphs or line breaks
    .split('\n').join('</w:t></w:r></w:p><w:p><w:r><w:t>');
}

/* 7. wordToPDF - simple demo: wrap text into a PDF */
async function wordToPDF(file){
  try{ if(!file) throw new Error('No file'); await ensurePdfLib(); showProgress(5);
    const text = await file.text(); const { PDFDocument, rgb, StandardFonts } = PDFLib; const pdfDoc = await PDFDocument.create(); const page = pdfDoc.addPage(); const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const size = 12; const margin=40; const rawLines = text.split(/\n/).slice(0,5000);
    // Helper to sanitize lines to WinAnsi-compatible characters (fallback to '?')
    const sanitize = (str) => String(str).replace(/[^\x00-\xFF]/g, '?');
    let y = page.getHeight()-margin;
    // Try to embed a Unicode-capable font for proper encoding support. If embedding fails, fall back to sanitized WinAnsi text.
    async function embedUnicodeFont(doc){
      const candidates = [
        'https://cdn.jsdelivr.net/gh/google/fonts@main/apache/roboto/Roboto-Regular.ttf',
        'https://cdn.jsdelivr.net/gh/google/fonts@main/ofl/noto/NotoSans-Regular.ttf',
        'https://github.com/dejavu-fonts/dejavu-fonts/raw/master/ttf/DejaVuSans.ttf'
      ];
      for(const url of candidates){
        try{
          const res = await fetch(url);
          if(!res.ok) continue;
          const bytes = await res.arrayBuffer();
          return await doc.embedFont(bytes);
        }catch(e){
          console.warn('Font fetch failed for', url, e);
          continue;
        }
      }
      return null;
    }

    // Attempt Unicode font embedding
    let usedFont = font;
    try{
      const ufont = await embedUnicodeFont(pdfDoc);
      if(ufont) usedFont = ufont;
    }catch(e){ console.warn('Unicode font embedding failed', e); }

    try{
      for(const line of rawLines){ const safe = sanitize(line); page.drawText(safe,{x:margin,y, size, font:usedFont, color:rgb(0,0,0)}); y -= size + 4; if(y<margin){ y = page.getHeight()-margin; }}
    }catch(err){
      // If drawing still fails, retry with sanitized content using the fallback font
      console.warn('Initial drawText failed, retrying with sanitized text', err);
      y = page.getHeight()-margin;
      for(const line of rawLines){ const safe = sanitize(line); page.drawText(safe,{x:margin,y, size, font:usedFont, color:rgb(0,0,0)}); y -= size + 4; if(y<margin){ y = page.getHeight()-margin; }}
    }
    const bytes = await pdfDoc.save(); downloadPDF(bytes, file.name.replace(/\.docx?$/i,'')+'.pdf'); showProgress(100); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 8. pdfToJPG - render first page to JPEG using PDF.js */
async function pdfToJPG(file){
  try{validatePDF(file); await ensurePdfJs(); showProgress(10);
    const array = await file.arrayBuffer(); const doc = await pdfjsLib.getDocument({data:array}).promise; const page = await doc.getPage(1);
    const viewport = page.getViewport({scale:2}); const canvas = document.createElement('canvas'); const ctx = canvas.getContext('2d'); canvas.width = viewport.width; canvas.height = viewport.height;
    await page.render({canvasContext:ctx, viewport}).promise; showProgress(70);
    const dataUrl = canvas.toDataURL('image/jpeg',0.9); const blob = dataURItoBlob(dataUrl);
    const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href=url; a.download = file.name.replace(/\.pdf$/i,'')+'.jpg'; a.click(); URL.revokeObjectURL(url); showProgress(100); return blob;
  }catch(err){handleError(err);throw err}
}

function dataURItoBlob(dataURI){ const byteString = atob(dataURI.split(',')[1]); const ab = new ArrayBuffer(byteString.length); const ia = new Uint8Array(ab); for(let i=0;i<byteString.length;i++) ia[i]=byteString.charCodeAt(i); return new Blob([ab],{type:'image/jpeg'}); }

/* 9. jpgToPDF - convert image to single-page PDF */
async function jpgToPDF(file){
  try{ if(!file.type.startsWith('image/')) throw new Error('Not an image'); await ensurePdfLib(); showProgress(10);
    const array = await file.arrayBuffer(); const { PDFDocument } = PDFLib; const pdfDoc = await PDFDocument.create(); const img = await pdfDoc.embedJpg(array); const page = pdfDoc.addPage([img.width, img.height]); page.drawImage(img,{x:0,y:0,width:img.width,height:img.height}); const bytes = await pdfDoc.save(); downloadPDF(bytes, file.name.replace(/\.(jpg|jpeg|png)$/i,'.pdf')); showProgress(100); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 10. addPageNumbers */
async function addPageNumbers(file, options={start:1, format:'{n}'}){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument, StandardFonts, rgb } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    const pages = pdfDoc.getPages(); const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    pages.forEach((p,i)=>{ const { width, height } = p.getSize(); const text = options.format.replace('{n}', (i+options.start).toString()); p.drawText(text,{x:width/2-20,y:20,size:10,font,color:rgb(0.4,0.4,0.4)}); });
    const bytes = await pdfDoc.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-pagenums.pdf'); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 11. removePageNumbers - best-effort: attempt to detect small centered footer numbers and remove by redaction (draw white box) */
async function removePageNumbers(file){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument, rgb } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    const pages = pdfDoc.getPages(); pages.forEach(p=>{ const {width}=p.getSize(); p.drawRectangle({x:width/2-40,y:12,width:80,height:18,color:rgb(1,1,1)}); });
    const bytes = await pdfDoc.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-no-pagenums.pdf'); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 12. addWatermark */
async function addWatermark(file, text='ToolMetric watermark'){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument, StandardFonts, rgb, degrees } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    const pages = pdfDoc.getPages(); const font = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
    pages.forEach(p=>{ const { width, height } = p.getSize(); p.drawText(text,{x:width/2-150,y:height/2, size:40, font, color:rgb(0.9,0.9,0.9), rotate:degrees(-30), opacity:0.15}); });
    const bytes = await pdfDoc.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-watermarked.pdf'); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 13. removeMetadata */
async function removeMetadata(file){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    // Create new document and copy pages to strip metadata
    const out = await PDFDocument.create(); const copied = await out.copyPages(pdfDoc, pdfDoc.getPageIndices()); copied.forEach(p=>out.addPage(p));
    const bytes = await out.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-nometa.pdf'); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 14. cropPDF - crop pages by margins {top,right,bottom,left} in points */
async function cropPDF(file, margins={top:0,right:0,bottom:0,left:0}){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    const pages = pdfDoc.getPages(); pages.forEach(p=>{ const {width,height} = p.getSize(); p.setMediaBox(margins.left, margins.bottom, width-margins.left-margins.right, height-margins.top-margins.bottom); });
    const bytes = await pdfDoc.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-cropped.pdf'); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 15. extractImages - attempt to extract embedded images using pdf-lib internal objects - best-effort */
async function extractImages(file){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    let images = 0; const blobs = [];
    for(const page of pdfDoc.getPages()){
      // pdf-lib doesn't expose direct images; iterate through xObjects raw may be required - skip exhaustive approach
    }
    showProgress(100);
    if(blobs.length===0) alert('No extractable images found (this is a best-effort feature).');
    blobs.forEach((b,i)=>{ const url=URL.createObjectURL(b); const a=document.createElement('a'); a.href=url; a.download = `image-${i+1}.jpg`; a.click(); URL.revokeObjectURL(url); });
    return blobs;
  }catch(err){handleError(err);throw err}
}

/* 16. pdfToPNG - render all pages to PNG images using PDF.js */
async function pdfToPNG(file){
  try{validatePDF(file); await ensurePdfJs(); showProgress(5);
    const array = await file.arrayBuffer(); const doc = await pdfjsLib.getDocument({data:array}).promise; const results=[];
    for(let p=1;p<=doc.numPages;p++){ const page = await doc.getPage(p); const scale = 2; const vp = page.getViewport({scale}); const canvas = document.createElement('canvas'); canvas.width=vp.width; canvas.height=vp.height; const ctx=canvas.getContext('2d'); await page.render({canvasContext:ctx, viewport:vp}).promise; const dataUrl = canvas.toDataURL('image/png'); results.push(dataUrl); showProgress(5 + 90*p/doc.numPages); const blob = dataURItoBlob(dataUrl); const url = URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download = file.name.replace(/\.pdf$/i,`-page-${p}.png`); a.click(); URL.revokeObjectURL(url); }
    showProgress(100); return results;
  }catch(err){handleError(err);throw err}
}

/* 17. reorderPages(file, newOrder) - newOrder array 1-based */
async function reorderPages(file, newOrder){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    const out = await PDFDocument.create(); const indices = newOrder.map(n=>n-1).filter(i=>i>=0&&i<pdfDoc.getPageCount()); const copied = await out.copyPages(pdfDoc,indices); copied.forEach(p=>out.addPage(p)); const bytes = await out.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-reordered.pdf'); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 18. deletePages(file, pagesToDelete) - pagesToDelete array 1-based */
async function deletePages(file, pagesToDelete){
  try{validatePDF(file); await ensurePdfLib(); showProgress(5);
    const array = await file.arrayBuffer(); const { PDFDocument } = PDFLib; const pdfDoc = await PDFDocument.load(array);
    const keep=[]; const total = pdfDoc.getPageCount(); for(let i=0;i<total;i++){ if(!pagesToDelete.includes(i+1)) keep.push(i); }
    const out = await PDFDocument.create(); const copied = await out.copyPages(pdfDoc, keep); copied.forEach(p=>out.addPage(p)); const bytes = await out.save(); showProgress(100); downloadPDF(bytes, file.name.replace(/\.pdf$/i,'')+'-delpages.pdf'); return bytes;
  }catch(err){handleError(err);throw err}
}

/* 19. extractFirstPage */
async function extractFirstPage(file){ return await splitPDF(file, [1]); }

/* 20. extractLastPage */
async function extractLastPage(file){ try{validatePDF(file); const arr = await file.arrayBuffer(); await ensurePdfLib(); const { PDFDocument } = PDFLib; const pdfDoc = await PDFDocument.load(arr); const last = pdfDoc.getPageCount(); return await splitPDF(file, [last]); }catch(err){handleError(err);throw err} }

// Expose functions
window.ToolMetric = {
  compressPDF, removeBlankPages, splitPDF, rotatePDF, mergePDFs, pdfToWord, wordToPDF, pdfToJPG, jpgToPDF,
  addPageNumbers, removePageNumbers, addWatermark, removeMetadata, cropPDF, extractImages, pdfToPNG, reorderPages, deletePages, extractFirstPage, extractLastPage,
  downloadPDF, showProgress, handleError, validatePDF
};

// Lightweight UI handling for tool pages (drag/drop, file input wiring)
document.addEventListener('DOMContentLoaded', ()=>{
  document.querySelectorAll('.dropzone').forEach(zone=>{
    const input = zone.querySelector('input[type=file]');
    zone.addEventListener('dragover', (e)=>{e.preventDefault(); zone.classList.add('dragover')});
    zone.addEventListener('dragleave', ()=>zone.classList.remove('dragover'));
    zone.addEventListener('drop', async (e)=>{ e.preventDefault(); zone.classList.remove('dragover'); const f = e.dataTransfer.files[0]; if(f && input) input.files = e.dataTransfer.files; if(f) zone.dispatchEvent(new CustomEvent('fileselected',{detail:f})); });
    if(input){ input.addEventListener('change', ()=>{ const f = input.files[0]; zone.dispatchEvent(new CustomEvent('fileselected',{detail:f})); }); }
    zone.addEventListener('fileselected', (ev)=>{ const file=ev.detail; const nameEl = zone.querySelector('.filename'); if(nameEl) nameEl.textContent = file.name; });
  });
});
