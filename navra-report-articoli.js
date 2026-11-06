/* NAVRA - Excel completo Articoli + Lotti, costruito in locale, anche offline.
 * Integra l'export preesistente (che conserva foto e dati finanziari), senza
 * modificare i record né richiedere librerie esterne o connessione Internet.
 * Caricare DOPO navra-upgrade.js e navra-lotti.js.
 */
'use strict';
(() => {
  const te = new TextEncoder(), td = new TextDecoder();
  const clean = s => String(s ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
  const xml = s => clean(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;').slice(0, 32000);
  const cents = n => Math.round((Number(n) || 0) * 100);
  const euro = n => cents(n) / 100;
  const l16 = (b, p) => b[p] | (b[p+1] << 8);
  const l32 = (b, p) => (b[p] | (b[p+1] << 8) | (b[p+2] << 16) | (b[p+3] << 24)) >>> 0;
  const put16 = (b,p,n) => {b[p]=n & 255;b[p+1]=(n>>>8)&255;};
  const put32 = (b,p,n) => {put16(b,p,n);put16(b,p+2,n>>>16);};
  const table = (() => {
    const a = new Uint32Array(256);
    for (let i=0;i<256;i++) {let c=i;for(let k=0;k<8;k++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;a[i]=c>>>0;}
    return a;
  })();
  const crc = bytes => {let c=0xffffffff;for(const b of bytes)c=table[(c^b)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  function unpack(bytes) {
    const files = new Map();
    let p=0;
    while (p+30 <= bytes.length && l32(bytes,p) === 0x04034b50) {
      if (l16(bytes,p+8) !== 0 || (l16(bytes,p+6)&8)) throw Error('Formato ZIP Excel inatteso.');
      const n=l16(bytes,p+26), e=l16(bytes,p+28), size=l32(bytes,p+18);
      const name=td.decode(bytes.subarray(p+30,p+30+n));
      const start=p+30+n+e, end=start+size;
      if (end > bytes.length) throw Error('File Excel incompleto.');
      files.set(name, bytes.slice(start,end));
      p=end;
    }
    if (!files.has('xl/workbook.xml') || !files.has('xl/worksheets/sheet1.xml')) throw Error('Export Excel NAVRA non riconosciuto.');
    return files;
  }
  function pack(files) {
    const local=[], central=[];
    let offset=0, centralSize=0;
    for (const [path, data] of files) {
      const name=te.encode(path), bytes=typeof data === 'string' ? te.encode(data) : data;
      if (!(bytes instanceof Uint8Array) || name.length > 65535) throw Error('File Excel non valido.');
      const checksum=crc(bytes), lh=new Uint8Array(30+name.length), ch=new Uint8Array(46+name.length);
      put32(lh,0,0x04034b50);put16(lh,4,20);put32(lh,14,checksum);
      put32(lh,18,bytes.length);put32(lh,22,bytes.length);put16(lh,26,name.length);lh.set(name,30);
      put32(ch,0,0x02014b50);put16(ch,4,20);put16(ch,6,20);
      put32(ch,16,checksum);put32(ch,20,bytes.length);put32(ch,24,bytes.length);
      put16(ch,28,name.length);put32(ch,42,offset);ch.set(name,46);
      local.push(lh,bytes); central.push(ch);offset+=lh.length+bytes.length;centralSize+=ch.length;
    }
    const end=new Uint8Array(22);
    put32(end,0,0x06054b50);put16(end,8,files.size);put16(end,10,files.size);
    put32(end,12,centralSize);put32(end,16,offset);
    const result=new Uint8Array(offset+centralSize+end.length);
    let p=0;for(const b of [...local,...central,end]) {result.set(b,p);p+=b.length;}
    return result;
  }
  function asText(files,key) {const b=files.get(key);if(!b)throw Error('Manca '+key);return td.decode(b);}
  const inline = (ref, value, style='0') => '<c r="'+ref+'" s="'+style+'" t="inlineStr"><is><t xml:space="preserve">'+xml(value)+'</t></is></c>';
  const number = (ref, val, style='3') => '<c r="'+ref+'" s="'+style+'"><v>'+euro(val)+'</v></c>';
  function modifyWatches(files, records) {
    const watches=records.filter(r=>r && !r.deleted_at && r.type==='watch');
    const lots=new Map(records.filter(r=>r && !r.deleted_at && r.type==='lot').map(r=>[r.id,r.data?.name||'']));
    let s=asText(files,'xl/worksheets/sheet1.xml');
    // Append columns W and X: all original financial formulas and photos keep their positions.
    s=s.replace(/A1:V(\d+)/g,'A1:X$1')
       .replace(/A4:V(\d+)/g,'A4:X$1')
       .replace('A1:V1','A1:X1').replace('A2:V2','A2:X2')
       .replace('>Orologi</t>', '>Articoli</t>')
       .replace('</cols>','<col min="23" max="23" width="19" customWidth="1"/><col min="24" max="24" width="30" customWidth="1"/></cols>');
    s=s.replace(/(<row r="4"[^>]*>)([\s\S]*?)(<\/row>)/,
      (_m,start,body,end)=>start+body+inline('W4','Categoria','2')+inline('X4','Lotto','2')+end);
    s=s.replace(/(<row r="(\d+)"[^>]*>)([\s\S]*?)(<\/row>)/g,
      (m,start,r,body,end)=>{
        const idx=Number(r)-5;
        if(idx<0 || idx>=watches.length)return m;
        const d=watches[idx].data||{};
        return start+body+inline('W'+r,d.category||'Orologi')+
          inline('X'+r,lots.get(d.lotId)||'')+end;
      });
    files.set('xl/worksheets/sheet1.xml', s);
  }
  function lotsSheet(records) {
    const lots=records.filter(r=>r && !r.deleted_at && r.type==='lot');
    const headers=['Lotto','Fornitore','Numero articoli','Prezzo acquisto','Spedizione','Altre spese',
      'Costo totale','Quota Stefano (%)','Pagato da','Data acquisto','Data spedizione','Data arrivo',
      'Ripartizione','Note','ID lotto'];
    const widths=[28,24,18,19,18,18,19,20,18,18,18,18,17,42,38];
    const col=i=>String.fromCharCode(65+i);
    const row0='<row r="1" ht="31" customHeight="1">'+inline('A1','Lotti','1')+'</row>'+
      '<row r="2" ht="24" customHeight="1">'+inline('A2','Dati dei lotti NAVRA. Acquisti e spese sono gia attribuiti alle schede dei singoli articoli.','6')+'</row>';
    const head='<row r="4" ht="29" customHeight="1">'+headers.map((h,i)=>inline(col(i)+'4',h,'2')).join('')+'</row>';
    const body=lots.map((r,i)=>{
      const d=r.data||{}, row=5+i, total=euro(d.totalPurchase)+euro(d.shippingCost)+euro(d.otherCosts);
      const vals=[d.name||'',d.supplier||'',Number(d.quantity)||0,euro(d.totalPurchase),euro(d.shippingCost),euro(d.otherCosts),
        euro(total),Number(d.shareStefano)||0,d.paidBy||'',d.purchaseDate||'',d.shippingDate||'',d.arrivalDate||'',
        d.mode==='manual'?'Manuale':'Equa',d.notes||'',r.id];
      return '<row r="'+row+'" ht="23" customHeight="1">'+vals.map((v,k)=>
        [2,3,4,5,6,7].includes(k)?number(col(k)+row,v,k===2||k===7?'5':'3'):inline(col(k)+row,v)
      ).join('')+'</row>';
    }).join('');
    const cols=widths.map((n,i)=>'<col min="'+(i+1)+'" max="'+(i+1)+'" width="'+n+'" customWidth="1"/>').join('');
    const last=Math.max(5,4+lots.length);
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'+
      '<dimension ref="A1:O'+last+'"/><sheetViews><sheetView workbookViewId="0"><pane ySplit="4" topLeftCell="A5" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>'+
      '<sheetFormatPr defaultRowHeight="17"/><cols>'+cols+'</cols><sheetData>'+row0+head+body+'</sheetData>'+
      '<mergeCells count="2"><mergeCell ref="A1:O1"/><mergeCell ref="A2:O2"/></mergeCells><autoFilter ref="A4:O'+last+'"/></worksheet>';
  }
  function patchPackage(bytes, records) {
    const files=unpack(bytes);
    modifyWatches(files,records);
    files.set('xl/worksheets/sheet9.xml', lotsSheet(records));
    let workbook=asText(files,'xl/workbook.xml');
    workbook=workbook.replace('<sheet name="Orologi"','<sheet name="Articoli"')
      .replace('</sheets>','<sheet name="Lotti" sheetId="9" r:id="rId9"/></sheets>');
    files.set('xl/workbook.xml',workbook);
    let rels=asText(files,'xl/_rels/workbook.xml.rels');
    // The old styles relation is rId9. Move it to rId10 and reserve rId9 for Lotti.
    rels=rels.replace(/(<Relationship Id=")rId9(" Type="[^"]*\/styles"[^>]*\/>)$/,'$1rId10$2');
    // In the original NAVRA export this relation is before </Relationships>, not at EOF.
    if (!rels.includes('Id="rId10"')) {
      rels=rels.replace('Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"',
        'Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles"');
    }
    if (!rels.includes('Id="rId10"')) throw Error('Relazioni Excel non riconosciute.');
    rels=rels.replace('</Relationships>',
      '<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet9.xml"/></Relationships>');
    files.set('xl/_rels/workbook.xml.rels',rels);
    let types=asText(files,'[Content_Types].xml');
    types=types.replace('</Types>',
      '<Override PartName="/xl/worksheets/sheet9.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>');
    files.set('[Content_Types].xml',types);
    return pack(files);
  }
  let busy=false;
  async function exportReport() {
    if(busy)return;
    if(!window.NavraExcel?.createXlsx) {alert('Prima deve essere caricato navra-upgrade.js.');return;}
    busy=true;
    const button=document.querySelector('[data-navra-excel]');
    if(button){button.disabled=true;button.textContent='Preparazione Excel...';}
    try {
      const records=await allRecords(),date=new Date();
      const source=window.NavraExcel.createXlsx(records,date);
      const bytes=patchPackage(source.bytes,records);
      const name='NAVRA-Articoli-Lotti-'+date.getFullYear()+'-'+String(date.getMonth()+1).padStart(2,'0')+'-'+String(date.getDate()).padStart(2,'0')+'.xlsx';
      const blob=new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'});
      const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;
      document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),90000);
      const status=document.getElementById('navra-export-status');
      if(status)status.textContent='Creato '+name+' con Articoli, Lotti, foto, Finanza, Costi e Cassa.';
    } catch(err) {alert('Export Excel non riuscito: '+err.message);}
    finally {busy=false;if(button){button.disabled=false;button.textContent='Scarica Excel completo';}}
  }
  // Intercettare sul documento prima del vecchio listener sul contenuto per non esportare due Excel.
  document.addEventListener('click',event=>{
    if(!event.target.closest?.('[data-navra-excel]'))return;
    event.preventDefault();event.stopPropagation();void exportReport();
  },true);
  const previousRender=render;
  render=function() {
    previousRender();
    if(state.view!=='report' && state.view!=='settings' && state.view!=='lots')return;
    const content=document.getElementById('content');
    if(!content)return;
    content.innerHTML=content.innerHTML
      .replaceAll('Orologi (foto incluse), Finanza','Articoli (foto incluse), Lotti, Finanza')
      .replaceAll('foto e riepilogo di orologi','foto e riepilogo di articoli e lotti')
      .replaceAll('Orologi acquistati','Articoli acquistati')
      .replaceAll('Orologi del lotto','Articoli del lotto')
      .replaceAll('Numero orologi','Numero articoli')
      .replaceAll('Una scheda per ciascun orologio','Una scheda per ciascun articolo');
  };
  const qtyLabel=document.querySelector('label[for="nl-quantity"]');
  if(qtyLabel)qtyLabel.textContent='Numero articoli *';
  const lotDialog=document.querySelector('#navra-lot-dialog .navra-lot-info');
  if(lotDialog)lotDialog.textContent='Ogni lotto genera una scheda per ciascun articolo: potrai poi aggiungere le foto, la categoria e il prezzo di vendita.';
  window.NavraExcelArticoli=Object.freeze({patchPackage,exportReport});
})();
