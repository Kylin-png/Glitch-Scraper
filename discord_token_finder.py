#!/usr/bin/env python3
"""
Discord Token Finder

This script opens each Glitch project edit page from a list,
examines all files in the project, and looks for potential Discord tokens.
"""

import os
import re
import time
import logging
import argparse
from typing import List, Set, Tuple

from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Regular expression patterns to identify potential Discord tokens
# These patterns cover various formats and contexts where Discord tokens appear

# Main token format pattern
MAIN_TOKEN_PATTERN = re.compile(r'[MN][A-Za-z\d]{23}\.[\w-]{6}\.[\w-]{27}|mfa\.[\w-]{84}')

# Pattern that looks for token assignments in code
TOKEN_ASSIGNMENT_PATTERN = re.compile(r'(?:token|TOKEN|Token|discord[_\.]?token|DISCORD[_\.]?TOKEN|auth[_\.]?token|bot[_\.]?token)["\']?\s*(?:=|:)\s*["\']([A-Za-z0-9_\.\-]{50,100})["\']')

# Pattern for tokens in environment variables
ENV_TOKEN_PATTERN = re.compile(r'(?:DISCORD_TOKEN|BOT_TOKEN|TOKEN)=(.*)')

def find_all_tokens(text: str) -> List[str]:
    """
    Find all potential Discord tokens in a text using multiple patterns
    
    Args:
        text: The text to search
        
    Returns:
        List[str]: List of found tokens
    """
    tokens = set()
    
    # Find direct token matches
    for match in MAIN_TOKEN_PATTERN.findall(text):
        tokens.add(match)
    
    # Find tokens in assignments
    for match in TOKEN_ASSIGNMENT_PATTERN.finditer(text):
        if match.group(1) and len(match.group(1)) >= 50:
            tokens.add(match.group(1))
    
    # Find tokens in environment variables
    for match in ENV_TOKEN_PATTERN.finditer(text):
        if match.group(1) and len(match.group(1)) >= 50:
            tokens.add(match.group(1))
            
    return list(tokens)

class DiscordTokenFinder:
    """
    A class to find Discord tokens in Glitch project files
    """
    
    def __init__(self, headless: bool = True):
        """
        Initialize the token finder with browser settings
        
        Args:
            headless: Whether to run the browser in headless mode (default: True)
        """
        self.found_tokens = set()
        
        # Configure Chrome options for Replit environment
        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless=new")
        
        # Common options for stability
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-extensions")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        
        # Initialize the webdriver with several fallback mechanisms
        try:
            logger.info("Initializing Chrome WebDriver...")
            # First try: use PATH-based chromedriver
            self.driver = webdriver.Chrome(options=chrome_options)
            logger.info("WebDriver initialized successfully with PATH")
        except WebDriverException as e:
            logger.warning(f"First attempt failed: {e}")
            try:
                # Second try: use the explicit chromedriver path
                chromedriver_path = "/nix/store/3qnxr5x6gw3k9a9i7d0akz0m6bksbwff-chromedriver-125.0.6422.141/bin/chromedriver"
                chrome_service = Service(chromedriver_path)
                self.driver = webdriver.Chrome(service=chrome_service, options=chrome_options)
                logger.info(f"WebDriver initialized successfully with explicit path: {chromedriver_path}")
            except WebDriverException as e2:
                logger.error(f"Failed to initialize Chrome WebDriver: {e2}")
                raise Exception("Could not initialize Chrome WebDriver after multiple attempts")
    
    def __del__(self):
        """
        Clean up webdriver when the instance is destroyed
        """
        if hasattr(self, 'driver'):
            try:
                self.driver.quit()
                logger.info("WebDriver closed successfully")
            except Exception as e:
                logger.warning(f"Error closing WebDriver: {e}")
    
    def navigate_to_project(self, edit_url: str) -> bool:
        """
        Navigate to a Glitch project edit page
        
        Args:
            edit_url: URL to the project edit page
            
        Returns:
            bool: True if navigation was successful
        """
        max_retries = 2
        
        # Handle incomplete URLs - ensure they end with ?path=
        if not edit_url.endswith("?path=") and "?path=" not in edit_url:
            edit_url = f"{edit_url.rstrip('/')}?path="
        
        for retry in range(max_retries):
            try:
                logger.info(f"Navigating to: {edit_url} (attempt {retry+1}/{max_retries})")
                self.driver.get(edit_url)
                
                # Wait for the page to load
                logger.info("Waiting for the page to load...")
                time.sleep(5)
                
                # More relaxed check - just ensure we reached a Glitch page
                page_title = self.driver.title
                if "Glitch" in page_title or "glitch" in self.driver.page_source.lower():
                    logger.info(f"Successfully loaded page: {page_title}")
                    return True
                else:
                    logger.warning(f"Page loaded, but it might not be Glitch. Title: {page_title}")
                    if retry < max_retries - 1:
                        logger.info("Retrying...")
                        time.sleep(2)
                    else:
                        return False
            except Exception as e:
                logger.error(f"Error navigating to project (attempt {retry+1}): {e}")
                if retry < max_retries - 1:
                    logger.info("Retrying...")
                    time.sleep(2)
                else:
                    return False
                    
        return False
    
    def get_common_file_paths(self, base_url: str) -> List[str]:
        """
        Generate URLs for common files where Discord tokens might be found
        
        Args:
            base_url: Base URL of the project editor
            
        Returns:
            List[str]: List of URLs to check
        """
        # Remove trailing ?path= if present
        if base_url.endswith("?path="):
            base_url = base_url[:-6]
            
        # Common file patterns where Discord tokens might be found
        # High priority files - most likely to contain tokens
        common_files = [
            # Environment and config files
            ".env",
            ".env.local",
            "config.js",
            "config.json",
            "secrets.json",
            
            # Discord-specific files
            "bot.js",
            "discord_bot.js", 
            "bot.py",
            "discord_bot.py",
            
            # Other common places for tokens
            "token.js",
            "auth.js",
            "credentials.json",
            "credentials.js",
            
            # Main application files
            "server.js",
            "index.js"
        ]
        
        # Generate full URLs
        file_urls = []
        for file in common_files:
            file_url = f"{base_url}?path={file}"
            file_urls.append(file_url)
            
        logger.info(f"Generated {len(file_urls)} common file paths to check")
        return file_urls
    
    def examine_file_for_tokens(self, file_url: str) -> List[Tuple[str, str]]:
        """
        Examine a single file for Discord tokens
        
        Args:
            file_url: URL to the file in the Glitch editor
            
        Returns:
            List[Tuple[str, str]]: List of (token, file_path) tuples
        """
        # Set a short timeout for page load
        self.driver.set_page_load_timeout(10)  # Maximum 10 seconds to load the page
        
        # Take screenshot of each file check
        try:
            file_path = file_url.split("path=")[1] if "path=" in file_url else "unknown_file"
            screenshot_name = f"check_{file_path.replace('/', '_')}.png"
            self.driver.save_screenshot(screenshot_name)
            logger.info(f"Saved screenshot: {screenshot_name}")
        except Exception as e:
            logger.warning(f"Failed to take screenshot: {e}")
        
        try:
            # Extract the filename for logging
            file_path = file_url.split("path=")[-1] if "path=" in file_url else "unknown_file"
            
            # Try to navigate to the file
            try:
                self.driver.get(file_url)
                time.sleep(2)  # Wait for the file to load
            except Exception as e:
                logger.warning(f"Error loading file {file_path}: {e}")
                return []
            
            # Check if we've actually reached a page with code
            if "not found" in self.driver.title.lower() or "404" in self.driver.title:
                logger.info(f"File {file_path} not found")
                return []
                
            try:
                # Scroll down multiple times to ensure we see all content
                self.scroll_code_editor()
                
                # Get the code content from the editor using multiple methods
                code_text = self.extract_code_content()
                
                # If no content found, skip this file
                if not code_text or len(code_text) < 10:
                    logger.info(f"No content found in {file_path}")
                    return []
                    
                # Search for tokens in the code using our enhanced pattern detection
                tokens = find_all_tokens(code_text)
                
                if tokens:
                    logger.info(f"Found {len(tokens)} potential tokens in {file_path}")
                    return [(token, file_path) for token in tokens]
                else:
                    return []
            except Exception as e:
                logger.warning(f"Error examining content of {file_path}: {e}")
                return []
                
        except Exception as e:
            logger.error(f"Error examining file: {e}")
            return []
        finally:
            # Reset the page load timeout to default
            self.driver.set_page_load_timeout(30)
            
    def scroll_code_editor(self):
        """
        Scroll through the code editor to make sure all content is loaded
        """
        try:
            # First try to find the editor container
            editor_containers = [
                ".CodeMirror-scroll",  # CodeMirror editor
                ".editor-container",   # Generic editor container
                ".code-editor",        # Another common class
                "pre.editor"           # Simple editor
            ]
            
            editor_element = None
            for selector in editor_containers:
                try:
                    elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    if elements:
                        editor_element = elements[0]
                        break
                except Exception:
                    continue
            
            if not editor_element:
                logger.warning("Could not find editor element to scroll")
                # Try to scroll the whole page as fallback
                self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
                time.sleep(1)
                return
                
            # Scroll the editor element multiple times to ensure we see everything
            for i in range(5):
                try:
                    # Scroll down in the editor
                    self.driver.execute_script("arguments[0].scrollTop = arguments[0].scrollHeight", editor_element)
                    time.sleep(0.5)
                except Exception as e:
                    logger.warning(f"Error scrolling editor (attempt {i+1}): {e}")
            
            # Go back to the top
            self.driver.execute_script("arguments[0].scrollTop = 0", editor_element)
            time.sleep(0.5)
            
        except Exception as e:
            logger.warning(f"Error scrolling code editor: {e}")
    
    def extract_code_content(self) -> str:
        """
        Extract code content from the editor using multiple methods
        
        Returns:
            str: The code content
        """
        code_text = ""
        
        # Try multiple methods to get the code content
        methods = [
            # Method 1: CodeMirror lines
            lambda: "\n".join([el.text for el in self.driver.find_elements(By.CSS_SELECTOR, ".CodeMirror-line") if el.text]),
            
            # Method 2: Pre elements
            lambda: "\n".join([el.text for el in self.driver.find_elements(By.CSS_SELECTOR, "pre.editor, pre.code") if el.text]),
            
            # Method 3: Code elements
            lambda: "\n".join([el.text for el in self.driver.find_elements(By.TAG_NAME, "code") if el.text]),
            
            # Method 4: Editor content div
            lambda: self.driver.find_element(By.CSS_SELECTOR, ".editor-content").text,
            
            # Method 5: Get entire visible text
            lambda: self.driver.find_element(By.TAG_NAME, "body").text,
            
            # Method 6: Last resort - get page source
            lambda: self.driver.page_source
        ]
        
        # Try each method until we get content
        for i, method in enumerate(methods):
            try:
                result = method()
                if result and len(result) > 10:  # Ensure we got meaningful content
                    code_text = result
                    break
            except Exception:
                continue
        
        return code_text
    
    def process_project(self, edit_url: str) -> List[Tuple[str, str]]:
        """
        Process a single project to find Discord tokens
        
        Args:
            edit_url: Base URL to the project edit page
            
        Returns:
            List[Tuple[str, str]]: List of (token, file_path) tuples
        """
        tokens_with_sources = []
        project_name = edit_url.split("#!/")[1].split("?")[0] if "#!/" in edit_url else "unknown_project"
        
        logger.info(f"Processing project: {project_name}")
        
        # Get a list of specific files to check for tokens
        file_urls = self.get_common_file_paths(edit_url)
        
        # Examine each specific file for tokens
        for file_url in file_urls:
            # Get the filename from the URL for logging
            file_path = file_url.split("path=")[1] if "path=" in file_url else "unknown_file"
            
            try:
                logger.info(f"Checking file: {file_path}")
                tokens_found = self.examine_file_for_tokens(file_url)
                
                if tokens_found:
                    logger.info(f"  Found {len(tokens_found)} potential token(s) in {file_path}")
                    tokens_with_sources.extend(tokens_found)
                else:
                    logger.info(f"  No tokens found in {file_path}")
                    
                # Short pause between file checks
                time.sleep(1)
            except Exception as e:
                logger.warning(f"Error examining file {file_path}: {e}")
                continue
        
        # Log the findings
        if tokens_with_sources:
            logger.info(f"Found {len(tokens_with_sources)} potential tokens in project {project_name}")
        else:
            logger.info(f"No tokens found in project {project_name}")
        
        return tokens_with_sources
    
    def process_projects_from_file(self, input_file: str, output_file: str) -> bool:
        """
        Process all projects listed in a file to find Discord tokens
        
        Args:
            input_file: Path to file containing list of project edit URLs
            output_file: Path to output file for found tokens
            
        Returns:
            bool: True if processing completed successfully
        """
        all_tokens = []
        
        try:
            # Read project URLs from input file
            with open(input_file, 'r', encoding='utf-8') as f:
                lines = [line.strip() for line in f if line.strip()]
                
            # Filter out header lines and comments
            project_urls = []
            for line in lines:
                # Skip comment lines or non-URL lines
                if line.startswith('#') or not line.startswith('http'):
                    continue
                
                # If it's a project URL, convert it to edit URL
                if line.startswith('https://glitch.com/~'):
                    project_name = line.replace('https://glitch.com/~', '')
                    edit_url = f"https://glitch.com/edit/#!/{project_name}?path="
                    project_urls.append(edit_url)
                # If it's already an edit URL, use it as is
                elif line.startswith('https://glitch.com/edit/'):
                    project_urls.append(line)
            
            logger.info(f"Found {len(project_urls)} valid projects to process")
            
            # Process each project
            for i, url in enumerate(project_urls, 1):
                try:
                    logger.info(f"Processing project {i}/{len(project_urls)}: {url}")
                    tokens = self.process_project(url)
                    all_tokens.extend(tokens)
                    
                    # Save progress after each project
                    self.save_tokens(all_tokens, output_file)
                    
                    # Add some delay between projects to avoid rate limiting
                    time.sleep(2)
                except Exception as e:
                    logger.error(f"Error processing project {url}: {e}")
                    continue
            
            logger.info(f"Completed processing all projects. Found {len(all_tokens)} potential tokens.")
            return True
        except Exception as e:
            logger.error(f"Error processing projects: {e}")
            return False
    
    def save_tokens(self, tokens: List[Tuple[str, str]], output_file: str) -> bool:
        """
        Save found tokens to a file
        
        Args:
            tokens: List of (token, file_path) tuples
            output_file: Path to output file
            
        Returns:
            bool: True if saving was successful
        """
        try:
            with open(output_file, 'w', encoding='utf-8') as f:
                if tokens:
                    for token, file_path in tokens:
                        f.write(f"Token: {token}\nFile: {file_path}\n\n")
                else:
                    f.write("No Discord tokens found.")
            
            logger.info(f"Saved {len(tokens)} tokens to {output_file}")
            return True
        except Exception as e:
            logger.error(f"Error saving tokens: {e}")
            return False


def main():
    """
    Parse command line arguments and run the token finder
    """
    parser = argparse.ArgumentParser(description="Find Discord tokens in Glitch projects")
    parser.add_argument("--input", type=str, required=True,
                        help="Input file with list of project edit URLs")
    parser.add_argument("--output", type=str, default="discord_tokens.txt",
                        help="Output file for found tokens (default: discord_tokens.txt)")
    parser.add_argument("--no-headless", action="store_true",
                        help="Disable headless mode (show browser UI)")
    
    args = parser.parse_args()
    
    logger.info(f"Starting Discord token finder with input: {args.input}")
    
    try:
        finder = DiscordTokenFinder(not args.no_headless)
        success = finder.process_projects_from_file(args.input, args.output)
        
        if success:
            logger.info(f"Token finding completed successfully. Results saved to {args.output}")
            return 0
        else:
            logger.error("Token finding process failed")
            return 1
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return 1


if __name__ == "__main__":
    exit(main())