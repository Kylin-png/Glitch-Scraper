#!/usr/bin/env python3
"""
Glitch Search Scraper

This script scrapes links from Glitch search results page, scrolls to load more content,
and saves the links to a text file.
"""

import os
import time
import logging
import argparse
from urllib.parse import urlparse, parse_qs
from typing import List, Set

from selenium import webdriver
from selenium.webdriver.firefox.service import Service
from selenium.webdriver.firefox.options import Options
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.common.exceptions import TimeoutException, WebDriverException
from bs4 import BeautifulSoup

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

class GlitchScraper:
    """
    A class to scrape links from Glitch search results
    """
    
    def __init__(self, query: str, filter_type: str = "project", headless: bool = True):
        """
        Initialize the scraper with search query and filter type
        
        Args:
            query: The search term to use
            filter_type: The filter to apply (default: project)
            headless: Whether to run the browser in headless mode (default: True)
        """
        self.query = query
        self.filter_type = filter_type
        # Properly encode spaces in the query
        encoded_query = query.replace(' ', '%20')
        self.url = f"https://glitch.com/search?q={encoded_query}&activeFilter={filter_type}"
        self.found_links = set()
        
        # Configure Chrome options for Replit environment
        from selenium.webdriver.chrome.options import Options
        from selenium.webdriver.chrome.service import Service
        
        chrome_options = Options()
        if headless:
            chrome_options.add_argument("--headless=new")
        
        # Common options for stability
        chrome_options.add_argument("--no-sandbox")
        chrome_options.add_argument("--disable-dev-shm-usage")
        chrome_options.add_argument("--disable-extensions")
        chrome_options.add_argument("--disable-gpu")
        chrome_options.add_argument("--window-size=1920,1080")
        chrome_options.add_argument("--remote-debugging-port=9222")
        
        # Initialize the webdriver with several fallback mechanisms
        try:
            logger.info("Trying to initialize Chrome WebDriver...")
            # First try: use PATH-based chromedriver (which might be set up by Replit)
            self.driver = webdriver.Chrome(options=chrome_options)
            logger.info("WebDriver initialized successfully with PATH")
        except WebDriverException as e1:
            logger.warning(f"First attempt failed: {e1}")
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
    
    def navigate_to_search_page(self):
        """
        Navigate to the Glitch search page and wait for initial load
        """
        max_attempts = 3
        for attempt in range(1, max_attempts + 1):
            try:
                logger.info(f"Navigating to URL: {self.url} (attempt {attempt}/{max_attempts})")
                self.driver.get(self.url)
                
                # Wait for 10 seconds for page to load, as requested
                logger.info("Waiting 10 seconds for page to load...")
                time.sleep(10)
                
                # Verify the page loaded by checking for common elements
                if "glitch" in self.driver.title.lower():
                    logger.info(f"Page loaded successfully: {self.driver.title}")
                    return True
                else:
                    logger.warning(f"Page may not have loaded correctly. Title: {self.driver.title}")
                    
                return True
            except WebDriverException as e:
                logger.error(f"Error navigating to search page (attempt {attempt}/{max_attempts}): {e}")
                if attempt < max_attempts:
                    logger.info(f"Retrying in 3 seconds...")
                    time.sleep(3)
                else:
                    return False
            except Exception as e:
                logger.error(f"Unexpected error during navigation (attempt {attempt}/{max_attempts}): {e}")
                if attempt < max_attempts:
                    logger.info(f"Retrying in 3 seconds...")
                    time.sleep(3)
                else:
                    return False
    
    def extract_links_from_current_page(self) -> int:
        """
        Extract all links from the current page state
        
        Returns:
            int: Number of new links found
        """
        initial_count = len(self.found_links)
        
        try:
            # Get the page source and parse it with BeautifulSoup
            soup = BeautifulSoup(self.driver.page_source, 'html.parser')
            
            # Find all anchor tags with href attribute
            for link in soup.find_all('a'):
                # Safe way to get href attribute in BeautifulSoup
                href = link.get('href')
                if href:
                    href_value = str(href)
                    
                    # Only collect links that start with "https://glitch.com/~" (project links)
                    # or convert relative links that point to projects
                    if href_value.startswith('/~'):
                        # This is a relative project link, convert to full URL
                        full_url = f"https://glitch.com{href_value}"
                        if full_url.startswith("https://glitch.com/~"):
                            self.found_links.add(full_url)
                    elif href_value.startswith('https://glitch.com/~'):
                        # This is already a full project URL
                        self.found_links.add(href_value)
                    
            # Find all button elements that might contain links
            buttons = self.driver.find_elements(By.TAG_NAME, 'button')
            for button in buttons:
                try:
                    # Check if button has a data-url attribute or onclick that contains a URL
                    data_url = button.get_attribute('data-url')
                    if data_url and isinstance(data_url, str):
                        # Only include project links
                        if data_url.startswith('/~'):
                            # Convert relative project links
                            full_url = f"https://glitch.com{data_url}"
                            if full_url.startswith("https://glitch.com/~"):
                                self.found_links.add(full_url)
                        elif data_url.startswith('https://glitch.com/~'):
                            # Direct project links
                            self.found_links.add(data_url)
                except Exception as e:
                    logger.warning(f"Error processing button: {e}")
                    continue
        except Exception as e:
            logger.error(f"Error extracting links: {e}")
        
        new_links_count = len(self.found_links) - initial_count
        logger.info(f"Found {new_links_count} new links, total: {len(self.found_links)}")
        return new_links_count
    
    def scroll_page(self, scroll_amount: int = 800) -> bool:
        """
        Scroll the page down to load more content
        
        Args:
            scroll_amount: Amount of pixels to scroll down
            
        Returns:
            bool: True if scrolling was successful
        """
        try:
            # Get current scroll position
            current_position = self.driver.execute_script("return window.pageYOffset;")
            
            # Scroll down
            self.driver.execute_script(f"window.scrollBy(0, {scroll_amount});")
            
            # Wait a bit for content to load
            time.sleep(2)
            
            # Check if we've moved from the original position
            new_position = self.driver.execute_script("return window.pageYOffset;")
            
            # If we're at the same position, we might have reached the bottom
            if new_position <= current_position:
                logger.info("Reached the bottom of the page")
                return False
            
            logger.info(f"Scrolled down {new_position - current_position} pixels")
            return True
        except WebDriverException as e:
            logger.error(f"Error scrolling page: {e}")
            return False
    
    def save_links_to_file(self, filename: str) -> bool:
        """
        Save all found links to a text file
        
        Args:
            filename: Name of the file to save links to
            
        Returns:
            bool: True if saving was successful
        """
        try:
            with open(filename, 'w', encoding='utf-8') as f:
                # Sort links for consistent output
                sorted_links = sorted(self.found_links)
                for link in sorted_links:
                    # Convert project URLs to edit URLs
                    # From: https://glitch.com/~project-name
                    # To:   https://glitch.com/edit/#!/project-name?path=
                    if link.startswith("https://glitch.com/~"):
                        project_name = link.replace("https://glitch.com/~", "")
                        edit_url = f"https://glitch.com/edit/#!/{project_name}?path="
                        f.write(f"{edit_url}\n")
                    
            logger.info(f"Successfully saved {len(self.found_links)} transformed edit links to {filename}")
            return True
        except Exception as e:
            logger.error(f"Error saving links to file: {e}")
            return False
    
    def run(self, max_scrolls: int = 20, output_file: str = "glitch_links.txt") -> bool:
        """
        Run the full scraping process
        
        Args:
            max_scrolls: Maximum number of times to scroll the page
            output_file: Name of the file to save links to
            
        Returns:
            bool: True if the process completed successfully
        """
        # Ensure we have a valid output filename
        if not output_file:
            output_file = f"glitch_{self.query}_{int(time.time())}.txt"
        
        # Navigate to the search page and wait for it to load
        if not self.navigate_to_search_page():
            logger.error("Failed to navigate to search page, aborting.")
            return False
        
        # Extract links from the initial page load
        initial_links = self.extract_links_from_current_page()
        logger.info(f"Initial page load found {initial_links} links")
        
        # Scroll and extract more links
        scroll_count = 0
        consecutive_no_new_links = 0
        
        while scroll_count < max_scrolls:
            if not self.scroll_page():
                logger.info("Cannot scroll further, probably reached the end of the page")
                break
                
            # Extract links after scrolling
            new_links = self.extract_links_from_current_page()
            
            # If we didn't find any new links for 3 consecutive scrolls, stop
            if new_links == 0:
                consecutive_no_new_links += 1
                if consecutive_no_new_links >= 3:
                    logger.info("No new links found in the last 3 scrolls, stopping")
                    break
            else:
                consecutive_no_new_links = 0
                
            scroll_count += 1
            
        # Log the final count of found links
        logger.info(f"Completed scraping with {len(self.found_links)} total links found across {scroll_count} scrolls")
            
        # Save all found links to the specified file
        return self.save_links_to_file(output_file)


def main():
    """
    Parse command line arguments and run the scraper
    """
    parser = argparse.ArgumentParser(description="Scrape links from Glitch search results")
    parser.add_argument("--query", type=str, default="discord", 
                        help="Search query to use (default: discord)")
    parser.add_argument("--filter", type=str, default="project", 
                        help="Filter type to apply (default: project)")
    parser.add_argument("--output", type=str, default="glitch_links.txt", 
                        help="Output file name (default: glitch_links.txt)")
    parser.add_argument("--max-scrolls", type=int, default=20, 
                        help="Maximum number of scrolls (default: 20)")
    parser.add_argument("--no-headless", action="store_true", 
                        help="Disable headless mode (show browser UI)")
    
    args = parser.parse_args()
    
    # Generate a default output filename based on the query if none specified
    output_file = args.output
    if not output_file or output_file == "glitch_links.txt":
        query_part = args.query.replace(" ", "_").lower()
        output_file = f"glitch_{query_part}_links.txt"
    
    logger.info(f"Starting scraper with query: {args.query}, filter: {args.filter}")
    logger.info(f"Results will be saved to: {output_file}")
    
    # Initialize and run the scraper
    try:
        scraper = GlitchScraper(args.query, args.filter, not args.no_headless)
        success = scraper.run(args.max_scrolls, output_file)
        
        if success:
            logger.info(f"Scraping completed successfully. Results saved to {output_file}")
            return 0
        else:
            logger.error("Scraping process failed")
            return 1
    except KeyboardInterrupt:
        logger.info("Scraping interrupted by user")
        return 130
    except Exception as e:
        logger.error(f"Unexpected error: {e}")
        return 1


if __name__ == "__main__":
    exit(main())
