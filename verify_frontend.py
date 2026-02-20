from playwright.sync_api import sync_playwright

def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        page = browser.new_page()
        try:
            page.goto("http://localhost:3000")
            page.wait_for_selector("#login-section")

            # Verify Login Screen
            if page.is_visible("#login-section"):
                print("Login section visible")
            else:
                print("Login section NOT visible")

            # Fill fake creds
            page.fill("#login-user", "node1")
            page.fill("#login-pass", "password")

            # Take screenshot of login screen
            page.screenshot(path="login_screen.png")
            print("Screenshot saved to login_screen.png")

        except Exception as e:
            print(f"Error: {e}")
        finally:
            browser.close()

if __name__ == "__main__":
    run()
