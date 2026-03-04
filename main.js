const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs   = require('fs')
const { execFile } = require('child_process')

function getFFmpeg() {
  const packed = path.join(process.resourcesPath, 'ffmpeg.exe')
  if (fs.existsSync(packed)) return packed
  try { return require('ffmpeg-static') } catch(e) { return null }
}

let win

function createWindow() {
  win = new BrowserWindow({
    width: 920, height: 820,
    minWidth: 680, minHeight: 600,
    title: 'VideoForge',
    backgroundColor: '#0a0a0f',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })
  win.loadFile('index.html')
  win.setMenuBarVisibility(false)
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => app.quit())

function runFFmpeg(args, onProgress) {
  return new Promise((resolve, reject) => {
    const ffmpeg = getFFmpeg()
    if (!ffmpeg) return reject(new Error('ffmpeg.exe not found'))
    const proc = execFile(ffmpeg, args, { maxBuffer: 200 * 1024 * 1024 })
    let stderr = '', duration = 0
    proc.stderr.on('data', chunk => {
      const text = chunk.toString()
      stderr += text
      if (!duration) {
        const m = text.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
        if (m) duration = +m[1]*3600 + +m[2]*60 + parseFloat(m[3])
      }
      const t = text.match(/time=(\d+):(\d+):(\d+\.?\d*)/)
      if (t && duration > 0) {
        const cur = +t[1]*3600 + +t[2]*60 + parseFloat(t[3])
        onProgress && onProgress(Math.min(0.99, cur / duration))
      }
    })
    proc.on('close', code => {
      if (code === 0) resolve()
      else reject(new Error(stderr.slice(-600)))
    })
  })
}

ipcMain.handle('video-info', async (e, filePath) => {
  return new Promise(resolve => {
    const proc = execFile(getFFmpeg(), ['-i', filePath])
    let stderr = ''
    proc.stderr.on('data', d => stderr += d.toString())
    proc.on('close', () => {
      const dm = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.?\d*)/)
      const rm = stderr.match(/(\d{2,5})x(\d{2,5})/)
      resolve({
        duration: dm ? +dm[1]*3600 + +dm[2]*60 + parseFloat(dm[3]) : 0,
        width:    rm ? +rm[1] : 0,
        height:   rm ? +rm[2] : 0
      })
    })
  })
})

ipcMain.handle('compress', async (e, { inputPath, height, crf }) => {
  // Ask user where to save — no file left behind without permission
  const { filePath: out, canceled } = await dialog.showSaveDialog(win, {
    title: 'Сохранить сжатое видео',
    defaultPath: inputPath.replace(/\.[^.]+$/, `_compressed_${height}p.mp4`),
    filters: [{ name: 'MP4', extensions: ['mp4'] }]
  })
  if (canceled || !out) return { canceled: true }

  await runFFmpeg([
    '-y', '-i', inputPath,
    '-vf', `scale=-2:${height}`,
    '-c:v', 'libx264', '-crf', String(crf), '-preset', 'fast',
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', out
  ], r => win.webContents.send('compress-progress', r))
  return { outputPath: out, size: fs.statSync(out).size }
})

ipcMain.handle('split', async (e, { inputPath, segDur, duration, outputDir, deleteSrcAfter }) => {
  const count = Math.ceil(duration / segDur)
  for (let i = 0; i < count; i++) {
    const start = i * segDur
    const dur   = Math.min(segDur, duration - start)
    const out   = path.join(outputDir, `fragment_${String(i+1).padStart(2,'0')}.mp4`)
    win.webContents.send('split-progress', { index: i, count, start, dur })
    await runFFmpeg([
      '-y', '-ss', String(start), '-i', inputPath,
      '-t', String(dur), '-c', 'copy', '-avoid_negative_ts', 'make_zero', out
    ], null)
  }
  // Delete the compressed temp file after splitting if requested
  if (deleteSrcAfter && fs.existsSync(inputPath)) {
    try { fs.unlinkSync(inputPath) } catch(e) {}
  }
  win.webContents.send('split-progress', { index: count, count, done: true })
})

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
  return r.filePaths[0] || null
})

ipcMain.handle('open-folder', (e, p) => shell.openPath(p))

