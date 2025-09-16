import asyncio
import os
import sys
import json
import signal
import threading
import time
from pathlib import Path
from flask import Flask, request, jsonify
from browser_use import Agent, BrowserSession   
from browser_use.browser.profile import BrowserProfile
from browser_use.llm import ChatGoogle

app = Flask(__name__)

# Global variables to track browser session and agent
browser_session = None
agent = None
current_task = None
task_running = False
shutdown_requested = False

def load_api_key():
    return os.environ.get("GEMINI_API_KEY")

GOOGLE_API_KEY = load_api_key()

def clean_up():
    global agent, browser_session, task_running
    if agent:
        try:
            agent.close()
            print("Agent closed") 
        except Exception as e:
            print(f"Error closing agent: {e}")
    
    # Close browser session if it exists
    if browser_session:
        try:
            browser_session.close()
            print("Browser session closed")
        except Exception as e:
            print(f"Error closing browser session: {e}")
    
    task_running = False 

async def run_task(task, model="gemini-2.5-flash"):
    global browser_session, agent, shutdown_requested, task_running
    
    try:
        print(f"Starting task: {task}")
        task_running = True
        shutdown_requested = False
        
        chrome_app = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

        browser_profile = BrowserProfile(executable_path=chrome_app, headless=False)
        browser_session = BrowserSession(browser_profile=browser_profile)
        
        agent = Agent(task=task,
            llm=ChatGoogle(model=model), browser_session=browser_session)
        
        # Run the agent
        await agent.run()
        
        print("Task completed successfully.")
        clean_up()
        return {"success": True, "stopped": False}
        
    except Exception as e:
        print(f"Error during task execution: {e}")
        return {"success": False, "error": str(e)}
    finally:
        clean_up()
        task_running = False

def run_task_in_thread(task, model="gemini-2.5-flash"):
    """Run the task in a separate thread"""
    global current_task
    current_task = asyncio.run(run_task(task, model))

@app.route('/start_task', methods=['POST'])
def start_task():
    global task_running, current_task
    
    if task_running:
        return jsonify({"success": False, "error": "Task already running"})
    
    data = request.get_json()
    task = data.get('task', '')
    model = data.get('model', 'gemini-2.5-flash')
    
    if not task:
        return jsonify({"success": False, "error": "Task is required"})
    
    # Start task in a separate thread
    thread = threading.Thread(target=run_task_in_thread, args=(task, model))
    thread.daemon = True
    thread.start()
    
    return jsonify({"success": True, "message": "Task started"})

@app.route('/stop_task', methods=['POST'])
def stop_task():
    global shutdown_requested
    
    print("Stop request received")
    shutdown_requested = True
    clean_up()

    return jsonify({"success": True, "message": "Stop signal sent and browser closed"})

@app.route('/status', methods=['GET'])
def get_status():
    global task_running, shutdown_requested
    
    return jsonify({
        "task_running": task_running,
        "shutdown_requested": shutdown_requested
    })

@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "healthy"})

# Set up signal handlers for graceful shutdown
def signal_handler(signum, frame):
    """Handle shutdown signals gracefully"""
    global shutdown_requested, browser_session, agent
    print(f"\nReceived signal {signum}. Shutting down gracefully...")
    print(f"Signal name: {signal.Signals(signum).name}")
    shutdown_requested = True
    
    # Close browser session if it exists
    if browser_session:
        try:
            print("Closing browser session due to signal...")
            # Use asyncio to close browser session
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                loop.run_until_complete(browser_session.close())
                print("Browser session closed successfully")
            finally:
                loop.close()
        except Exception as e:
            print(f"Error closing browser session: {e}")
    
    # Exit the process
    sys.exit(0)

if __name__ == '__main__':
    print("Setting up signal handlers...")
    signal.signal(signal.SIGINT, signal_handler)
    signal.signal(signal.SIGTERM, signal_handler)
    print("Signal handlers set up successfully")
    
    # Start Flask server
    print("Starting Flask server on port 5005...")
    try:
        # Use werkzeug's development server with better signal handling
        from werkzeug.serving import run_simple
        run_simple('127.0.0.1', 5005, app, use_reloader=False, use_debugger=False)
    except Exception as e:
        print(f"Error starting Flask server: {e}")
        sys.exit(1) 