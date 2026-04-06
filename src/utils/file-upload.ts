import { getVFSFile, listVFSFiles } from '@/utils/db';
import { writeTempFile, cleanupTempFile } from '@/utils/cdp';
import { log } from '@/utils/agent-log';
import { sleep } from '@/utils/sleep';
import type { CoordinateEntry } from '@/utils/types';

export async function injectFileUpload(
  tabId: number,
  sessionId: number,
  uploadFileId: string,
  target: CoordinateEntry,
): Promise<void> {
  let vfsFile = await getVFSFile(uploadFileId);
  if (!vfsFile) {
    const allFiles = await listVFSFiles(sessionId);
    vfsFile = allFiles.find((f) => f.name === uploadFileId);
  }
  if (!vfsFile) throw new Error(`VFS file "${uploadFileId}" not found.`);
  await log(`Uploading "${vfsFile.name}" → element #${target.id}`, 'act');

  const { x, y } = target.rect;

  // Phase 1: HTML5 drag-drop
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression: `window.__oc_dd={b:${JSON.stringify(vfsFile.data)},n:${JSON.stringify(vfsFile.name)},t:${JSON.stringify(vfsFile.mimeType)}}`,
  });
  await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
    expression: `(function(){
      var d=window.__oc_dd; delete window.__oc_dd; if(!d) return;
      try {
        var bytes=Uint8Array.from(atob(d.b),function(c){return c.charCodeAt(0);});
        var file=new File([bytes],d.n,{type:d.t});
        var dt=new DataTransfer(); dt.items.add(file);
        function drag(el){
          ['dragenter','dragover','drop'].forEach(function(ev){
            el.dispatchEvent(new DragEvent(ev,{dataTransfer:dt,bubbles:true,cancelable:true}));
          });
        }
        var tgt=document.elementFromPoint(${x},${y});
        if(tgt) drag(tgt);
        var inp=window.__opticlick_fileInput||document.querySelector('input[type="file"]');
        if(inp&&inp!==tgt) drag(inp);
      } catch(e){}
    })()`,
  });
  await sleep(300);

  // Phase 2: CDP fallback for <input type="file"> that ignored the drop
  const tempDl = await writeTempFile(vfsFile.data, vfsFile.name, vfsFile.mimeType);
  try {
    const inputEval = (await chrome.debugger.sendCommand({ tabId }, 'Runtime.evaluate', {
      expression: `(function(){
        var inp=window.__opticlick_fileInput||document.querySelector('input[type="file"]');
        return (inp&&inp.files&&inp.files.length===0)?inp:null;
      })()`,
    })) as { result: { objectId?: string; subtype?: string } };
    const objectId = inputEval?.result?.objectId;
    if (objectId && inputEval.result.subtype !== 'null') {
      await chrome.debugger.sendCommand({ tabId }, 'DOM.setFileInputFiles', {
        objectId, files: [tempDl.filePath],
      });
      await log('Uploaded via drag-drop + CDP fallback', 'act');
    } else {
      await log('Uploaded via drag-drop', 'act');
    }
  } finally {
    await cleanupTempFile(tempDl.downloadId);
  }
}
