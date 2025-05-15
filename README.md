# Glitch Tools Suite

A Python toolkit for Glitch.com with two main features:

1. **Glitch Search Scraper**: Extracts project links from Glitch search results and transforms them into edit URLs.
2. **Discord Token Finder**: Examines Glitch projects for potential Discord tokens in the code files.

## Features

- Navigates to Glitch search page with query parameters
- Waits 10 seconds for page content to load
- Extracts only project links (URLs starting with "https://glitch.com/~")
- Scrolls down to find additional links
- Stops scrolling when no new links are found for 3 consecutive scrolls
- Saves extracted links to a text file
- Handles dynamic content loading
- Provides command-line options for customization
- Robust error handling with retries

## Requirements

- Python 3.6+
- Selenium WebDriver
- BeautifulSoup4
- Chrome/Firefox WebDriver

## Installation

1. Ensure you have Python 3.6 or higher installed.
2. Install the required dependencies:

```bash
pip install selenium beautifulsoup4
```

3. Make sure you have Chrome or Firefox installed, along with the appropriate WebDriver.

## Usage

### Command Line Options

```bash
python glitch_scraper.py --query "your_search_term" --filter project --max-scrolls 10 --output results.txt
```

### Available Arguments

- `--query`: The search term to use on Glitch (default: "discord")
- `--filter`: The filter type to apply (default: "project", options: "project", "app", "collection", "team")
- `--max-scrolls`: Maximum number of times to scroll the page (default: 20)
- `--output`: Output file name for the results (default: auto-generated based on query)
- `--no-headless`: Disable headless mode to show the browser UI

### Output Format

The script generates a text file containing:
- Metadata about the search (query, filter, timestamp)
- A list of all found links related to Glitch projects

## Usage Examples

### 1. Search and Extract Project Links

```bash
# Search for Python projects with up to 5 scrolls
python glitch_scraper.py --query python --filter project --max-scrolls 5

# Search for Discord bots
python glitch_scraper.py --query "discord bot" --filter project

# Search for JavaScript games and save to a specific file
python glitch_scraper.py --query "javascript game" --output js_games.txt
```

### 2. Find Discord Tokens in Projects

After using the scraper to generate a list of edit URLs, you can search through them for Discord tokens:

```bash
# Find Discord tokens in the projects from your scraped list
python discord_token_finder.py --input glitch_discord_links.txt --output found_tokens.txt

# If you want to see the browser UI during the process (for debugging)
python discord_token_finder.py --input glitch_discord_links.txt --no-headless
```

### Complete Workflow Example

Here's a complete workflow to search for Discord projects and check them for tokens:

```bash
# Step 1: Scrape Glitch for Discord-related projects
python glitch_scraper.py --query "discord bot" --filter project --output discord_projects.txt

# Step 2: Examine those projects for Discord tokens
python discord_token_finder.py --input discord_projects.txt --output found_discord_tokens.txt
```

## Web Interface

A simple web interface for the scraper is also available by running:

```bash
python main.py
```

Then access http://localhost:5000 in your browser for a user-friendly interface to search and generate project edit URLs.
