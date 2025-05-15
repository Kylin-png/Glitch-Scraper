"""
Main file for Glitch Scraper web interface
"""
from flask import Flask, render_template, request, redirect, url_for, flash, send_file
import os
import subprocess
import threading
import time

app = Flask(__name__)
app.secret_key = os.environ.get("SESSION_SECRET", "dev-secret-key")

# Global variables to track scraping status
scraping_status = {
    "running": False,
    "output_file": None,
    "progress": 0,
    "message": ""
}

def run_scraper(query, filter_type, max_scrolls, output_file):
    """Run the scraper in a separate thread"""
    global scraping_status
    
    try:
        scraping_status["running"] = True
        scraping_status["message"] = f"Starting scraper for '{query}'..."
        
        # Run the scraper script
        cmd = [
            "python", "glitch_scraper.py",
            "--query", query,
            "--filter", filter_type,
            "--max-scrolls", str(max_scrolls),
            "--output", output_file
        ]
        
        process = subprocess.run(cmd, check=True, capture_output=True, text=True)
        
        if process.returncode == 0:
            scraping_status["message"] = f"Scraping completed successfully. Results saved to {output_file}"
            scraping_status["output_file"] = output_file
        else:
            scraping_status["message"] = f"Scraping failed: {process.stderr}"
    except Exception as e:
        scraping_status["message"] = f"Error running scraper: {str(e)}"
    finally:
        scraping_status["running"] = False

@app.route('/')
def index():
    """Render the main page"""
    return render_template('index.html', status=scraping_status)

@app.route('/scrape', methods=['POST'])
def scrape():
    """Handle form submission to start scraping"""
    if scraping_status["running"]:
        flash("A scraping process is already running. Please wait until it completes.", "warning")
        return redirect(url_for('index'))
    
    query = request.form.get('query', 'discord')
    filter_type = request.form.get('filter', 'project')
    max_scrolls = int(request.form.get('max_scrolls', 5))
    output_file = f"glitch_links_{int(time.time())}.txt"
    
    # Start scraping in a background thread
    thread = threading.Thread(
        target=run_scraper,
        args=(query, filter_type, max_scrolls, output_file)
    )
    thread.daemon = True
    thread.start()
    
    flash(f"Started scraping for '{query}'. This may take a few minutes.", "info")
    return redirect(url_for('index'))

@app.route('/download')
def download():
    """Download the results file"""
    if scraping_status["output_file"] and os.path.exists(scraping_status["output_file"]):
        return send_file(scraping_status["output_file"], as_attachment=True)
    else:
        flash("No results file available to download.", "error")
        return redirect(url_for('index'))

@app.route('/status')
def status():
    """Return the current scraping status"""
    return scraping_status

# Create templates directory if it doesn't exist
if not os.path.exists('templates'):
    os.makedirs('templates')

# Create static directory if it doesn't exist
if not os.path.exists('static'):
    os.makedirs('static')

if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)