const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const { spawn, exec } = require('child_process');
const fs = require('fs');

app.setName('Instabase Browser Agent');
if (process.platform === 'darwin') {
  process.title = 'Instabase Browser Agent';
}

let mainWindow;
let currentPythonProcess = null;
let wasProcessStopped = false; // Track the current Python process
let serverRunning = false;

function killProcessTree(pid) {
  if (process.platform === 'win32') {
    // Windows: use taskkill to kill process tree
    exec(`taskkill /F /T /PID ${pid}`, (error) => {
      if (error) {
        console.log(`Error killing process tree on Windows: ${error.message}`);
      } else {
        console.log(`Killed process tree for PID ${pid} on Windows`);
      }
    });
  } else {
    // Unix: use pkill to kill process tree
    exec(`pkill -P ${pid}`, (error) => {
      if (error) {
        console.log(`Error killing child processes: ${error.message}`);
      } else {
        console.log(`Killed child processes for PID ${pid}`);
      }
    });
    
    // Also try to kill the main process
    exec(`kill -TERM ${pid}`, (error) => {
      if (error) {
        console.log(`Error killing main process: ${error.message}`);
      } else {
        console.log(`Sent TERM signal to PID ${pid}`);
      }
    });
  }
}

function getVenvPath() {
  if (app.isPackaged) {
    // In packaged app, .venv is in the app.asar.unpacked directory
    const venvPath = path.join(process.resourcesPath, 'app.asar.unpacked', '.venv');
    console.log('Packaged venv path:', venvPath);
    console.log('Packaged venv exists:', fs.existsSync(venvPath));
    return venvPath;
  } else {
    // In development, .venv is in the project root
    const venvPath = path.join(__dirname, '.venv');
    console.log('Dev venv path:', venvPath);
    console.log('Dev venv exists:', fs.existsSync(venvPath));
    return venvPath;
  }
}

function createWindow() {
  const iconPath = path.join(__dirname, 'resources', 'images', 'instabase-logo.png');
  if (!fs.existsSync(iconPath)) {
    console.warn(`Icon file not found: ${iconPath}`);
    console.log('Current directory:', __dirname);
    console.log('Available files in resources/images:', fs.readdirSync(path.join(__dirname, 'resources', 'images')));
  } else {
    console.log(`Using icon: ${iconPath}`);
  }
  mainWindow = new BrowserWindow({
    width: 900,
    height: 1000,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    icon: iconPath,
    show: false,
    titleBarStyle: 'default',
    title: 'Instabase Browser Agent',
    resizable: true,
    minWidth: 800,
    minHeight: 900
  });
  mainWindow.loadFile('index.html');
  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });
  if (process.argv.includes('--dev')) {
    mainWindow.webContents.openDevTools();
  }
}

function createMenu() {
  const template = [
    {
      label: 'File',
      submenu: [
        {
          label: 'About Instabase Browser Agent',
          click: () => {
            dialog.showMessageBox(mainWindow, {
              type: 'info',
              title: 'About Instabase Browser Agent',
              message: 'Instabase Browser Agent',
              detail: 'Version 1.0.0\n\nAgentic Browser Automation\n\n© Instabase, Inc. 2025',
              buttons: ['OK']
            });
          }
        },
        { type: 'separator' },
        {
          label: 'Quit',
          accelerator: 'Cmd+Q',
          click: () => {
            app.quit();
          }
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'Cmd+Z',
          role: 'undo'
        },
        {
          label: 'Redo',
          accelerator: 'Shift+Cmd+Z',
          role: 'redo'
        },
        { type: 'separator' },
        {
          label: 'Cut',
          accelerator: 'Cmd+X',
          role: 'cut'
        },
        {
          label: 'Copy',
          accelerator: 'Cmd+C',
          role: 'copy'
        },
        {
          label: 'Paste',
          accelerator: 'Cmd+V',
          role: 'paste'
        },
        {
          label: 'Select All',
          accelerator: 'Cmd+A',
          role: 'selectall'
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Reload',
          accelerator: 'Cmd+R',
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.reload();
          }
        },
        {
          label: 'Toggle Full Screen',
          accelerator: (() => {
            if (process.platform === 'darwin') return 'Ctrl+Cmd+F';
            else return 'F11';
          })(),
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.setFullScreen(!focusedWindow.isFullScreen());
          }
        },
        {
          label: 'Toggle Developer Tools',
          accelerator: (() => {
            if (process.platform === 'darwin') return 'Alt+Cmd+I';
            else return 'Ctrl+Shift+I';
          })(),
          click: (item, focusedWindow) => {
            if (focusedWindow) focusedWindow.webContents.toggleDevTools();
          }
        }
      ]
    },
    {
      label: 'Window',
      submenu: [
        {
          label: 'Minimize',
          accelerator: 'Cmd+M',
          role: 'minimize'
        },
        {
          label: 'Close',
          accelerator: 'Cmd+W',
          role: 'close'
        },
        { type: 'separator' },
        {
          label: 'Bring All to Front',
          role: 'front'
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.setAboutPanelOptions({
      applicationName: 'Instabase Browser Agent',
      applicationVersion: '1.0.0',
      version: '1.0.0',
      copyright: '© Instabase, Inc. 2025',
      website: 'https://instabase.com',
      iconPath: path.join(__dirname, 'resources', 'images', 'instabase-logo.png')
    });
  }
  createMenu();
  if (process.platform === 'darwin') {
    try {
      const iconPath = path.join(__dirname, 'resources', 'images', 'instabase-logo.png');
      if (fs.existsSync(iconPath)) {
        app.dock.setIcon(iconPath);
        console.log('Dock icon set successfully');
      } else {
        console.warn(`Dock icon file not found: ${iconPath}`);
      }
    } catch (error) {
      console.error('Error setting dock icon:', error);
    }
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

// Handle task submission
ipcMain.handle('submit-task', async (event, task) => {
  try {
    return new Promise(async (resolve, reject) => {
      try {
        // Start Flask server if not running
        if (!serverRunning) {
          await startFlaskServer();
        }
        
        // Wait for server to be ready
        await waitForServer();
        
        // Send task to Flask server
        const response = await fetch('http://127.0.0.1:5005/start_task', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ task: task, model: 'gemini-2.5-flash' })
        });
        
        const result = await response.json();
        
        if (result.success) {
          // Wait for task to complete
          await waitForTaskCompletion();
          
          // Kill Flask server after task completion (successful or stopped)
          setTimeout(() => {
            if (currentPythonProcess) {
              console.log('Killing Flask server after task completion...');
              
              // Kill the entire process tree
              killProcessTree(currentPythonProcess.pid);
              
              // Also try direct kill as backup
              currentPythonProcess.kill('SIGTERM');
              
              // Check if process is killed after 3 seconds
              setTimeout(() => {
                if (currentPythonProcess && !currentPythonProcess.killed) {
                  console.log('Force killing Flask server...');
                  currentPythonProcess.kill('SIGKILL');
                }
                
                // Always clean up references
                currentPythonProcess = null;
                serverRunning = false;
                console.log('Flask server cleanup completed after task completion');
              }, 3000);
            } else {
              console.log('No Flask server process to kill after task completion');
              serverRunning = false;
            }
          }, 1000); // Wait 1 second for any final cleanup
          
          resolve({ success: true, stopped: wasProcessStopped });
        } else {
          reject(new Error(result.error || 'Failed to start task'));
        }
      } catch (error) {
        console.error('Error in submit-task handler:', error);
        reject(error);
      }
    });
  } catch (error) {
    console.error('Error in submit-task handler:', error);
    throw error;
  }
});

async function startFlaskServer() {
  return new Promise((resolve, reject) => {
    // Kill any existing process
    if (currentPythonProcess) {
      console.log('Killing existing Python process');
      currentPythonProcess.kill();
      currentPythonProcess = null;
    }
    
    // Get the correct script path for packaged app
    let scriptPath;
    if (app.isPackaged) {
      // In packaged app, script is in the app.asar.unpacked directory
      scriptPath = path.join(process.resourcesPath, 'app.asar.unpacked', 'browser_server.py');
    } else {
      // In development, script is in the same directory
      scriptPath = path.join(__dirname, 'browser_server.py');
    }
    
    console.log('Script path:', scriptPath);
    console.log('Script exists:', fs.existsSync(scriptPath));
    
    // Determine Python path and environment
    const venvPath = getVenvPath();
    let pythonPath;
    let useVenv = false;
    
    // First try virtual environment Python
    if (fs.existsSync(venvPath)) {
      if (process.platform === 'win32') {
        pythonPath = path.join(venvPath, 'Scripts', 'python.exe');
      } else {
        pythonPath = path.join(venvPath, 'bin', 'python');
      }
      
      console.log('Virtual environment Python path:', pythonPath);
      console.log('Virtual environment Python exists:', fs.existsSync(pythonPath));
      
      if (fs.existsSync(pythonPath)) {
        useVenv = true;
        console.log(`Using virtual environment Python: ${pythonPath}`);
      }
    }
    
    // If virtual environment Python not found, try system Python
    if (!useVenv) {
      console.warn('Virtual environment not found or Python not available, trying system Python');
      
      // Try alternative Python paths
      const alternativePaths = [
        'python3',
        'python',
        '/usr/bin/python3',
        '/usr/bin/python',
        '/usr/local/bin/python3',
        '/usr/local/bin/python'
      ];
      
      let foundPython = false;
      for (const altPath of alternativePaths) {
        try {
          const { execSync } = require('child_process');
          execSync(`${altPath} --version`, { stdio: 'ignore' });
          pythonPath = altPath;
          console.log(`Found system Python at: ${pythonPath}`);
          foundPython = true;
          break;
        } catch (error) {
          console.log(`Python not found at: ${altPath}`);
        }
      }
      
      if (!foundPython) {
        reject(new Error('No Python installation found. Please install Python 3.7+'));
        return;
      }
    }
    
    console.log('Python path:', pythonPath);
    
    const env = {
      ...process.env
    };
    
    // Only set virtual environment if we're using it
    if (useVenv) {
      env.VIRTUAL_ENV = venvPath;
      if (process.platform === 'win32') {
        env.PATH = `${path.join(venvPath, 'Scripts')};${process.env.PATH}`;
      } else {
        env.PATH = `${path.join(venvPath, 'bin')}:${process.env.PATH}`;
      }
      console.log('Using virtual environment');
    } else {
      console.log('Using system Python');
    }
    
    console.log('Environment VIRTUAL_ENV:', env.VIRTUAL_ENV);
    console.log('Environment PATH:', env.PATH);
    
    console.log('Starting Flask server...');
    currentPythonProcess = spawn(pythonPath, [scriptPath], {
      env: env,
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false, // Ensure process is killed when parent exits
      cwd: path.dirname(scriptPath) // Set working directory to script location
    });
    
    currentPythonProcess.stdout.on('data', (data) => {
      console.log('Flask server output:', data.toString());
    });
    
    currentPythonProcess.stderr.on('data', (data) => {
      console.log('Flask server error:', data.toString());
    });
    
    currentPythonProcess.on('error', (error) => {
      console.error('Error starting Flask server:', error);
      reject(error);
    });
    
    currentPythonProcess.on('exit', (code, signal) => {
      console.log(`Flask server exited with code ${code} and signal ${signal}`);
      serverRunning = false;
      currentPythonProcess = null;
    });
    
    // Wait a bit for server to start
    setTimeout(() => {
      serverRunning = true;
      resolve();
    }, 3000);
  });
}

async function waitForServer() {
  const maxAttempts = 30;
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      const response = await fetch('http://127.0.0.1:5005/health');
      if (response.ok) {
        console.log('Flask server is ready');
        return;
      }
    } catch (error) {
      // Server not ready yet
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  throw new Error('Flask server failed to start');
}

async function waitForTaskCompletion() {
  const maxAttempts = 300; // 5 minutes
  let attempts = 0;
  
  while (attempts < maxAttempts) {
    try {
      const response = await fetch('http://127.0.0.1:5005/status');
      const status = await response.json();
      
      if (!status.task_running) {
        console.log('Task completed');
        return;
      }
      
      if (status.shutdown_requested) {
        console.log('Task was stopped');
        return;
      }
    } catch (error) {
      console.error('Error checking task status:', error);
    }
    
    await new Promise(resolve => setTimeout(resolve, 1000));
    attempts++;
  }
  
  throw new Error('Task timed out');
}

// Handle loading configuration
ipcMain.handle('load-config', async (event) => {
  try {
    const configPath = path.join(__dirname, 'resources', 'config', 'env.json');
    if (fs.existsSync(configPath)) {
      const configData = fs.readFileSync(configPath, 'utf8');
      return JSON.parse(configData);
    } else {
      return {
        "GEMINI_API_KEY": "your_gemini_api_key_here"
      };
    }
  } catch (error) {
    console.error('Error loading config:', error);
    throw error;
  }
});

// Handle saving configuration
ipcMain.handle('save-config', async (event, config) => {
  try {
    const configPath = path.join(__dirname, 'resources', 'config', 'env.json');
    const configDir = path.dirname(configPath);
    if (!fs.existsSync(configDir)) {
      fs.mkdirSync(configDir, { recursive: true });
    }
    if (!config.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required in configuration');
    }
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
    console.log('Configuration saved successfully');
    return { success: true };
  } catch (error) {
    console.error('Error saving config:', error);
    return { success: false, error: error.message };
  }
});

// Handle stopping the current task
ipcMain.handle('stop-task', async (event) => {
  try {
    if (!serverRunning) {
      console.log('No Flask server running');
      return { success: true, message: 'No server to stop' };
    }
    
    console.log('Stopping task via HTTP request...');
    
    // Set the stopped flag
    wasProcessStopped = true;
    
    // Send HTTP request to stop the task and close browser
    try {
      const response = await fetch('http://127.0.0.1:5005/stop_task', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        }
      });
      
      const result = await response.json();
      
      if (result.success) {
        console.log('Stop request sent successfully, browser should be closed');
        
            // Wait a moment for browser to close, then kill Flask server
    setTimeout(() => {
      if (currentPythonProcess) {
        console.log('Killing Flask server after browser close...');
        
        // Kill the entire process tree
        killProcessTree(currentPythonProcess.pid);
        
        // Also try direct kill as backup
        currentPythonProcess.kill('SIGTERM');
        
        // Check if process is killed after 3 seconds
        setTimeout(() => {
          if (currentPythonProcess && !currentPythonProcess.killed) {
            console.log('Force killing Flask server...');
            currentPythonProcess.kill('SIGKILL');
          }
          
          // Always clean up references
          currentPythonProcess = null;
          serverRunning = false;
          console.log('Flask server cleanup completed');
        }, 3000);
      } else {
        console.log('No Flask server process to kill');
        serverRunning = false;
      }
    }, 2000); // Wait 2 seconds for browser to close
        
        return { success: true };
      } else {
        console.log('Stop request failed:', result.error);
        return { success: false, error: result.error };
      }
    } catch (error) {
      console.error('Error sending stop request:', error);
      // Fallback to killing the process
      if (currentPythonProcess) {
        currentPythonProcess.kill('SIGTERM');
        setTimeout(() => {
          if (currentPythonProcess && !currentPythonProcess.killed) {
            currentPythonProcess.kill('SIGKILL');
          }
        }, 5000);
      }
      return { success: true };
    }
  } catch (error) {
    console.error('Error stopping task:', error);
    return { success: false, error: error.message };
  }
}); 