package main

import (
	"context"
	"fmt"
	"log"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/chromedp/cdproto/emulation"
	"github.com/chromedp/cdproto/network"
	"github.com/chromedp/cdproto/page"
	"github.com/chromedp/chromedp"
)

func set1280x800() chromedp.Action {
	return chromedp.ActionFunc(func(ctx context.Context) error {
		return emulation.SetDeviceMetricsOverride(1280, 800, 1.0, false).Do(ctx)
	})
}

func navigateFast(urlstr string) chromedp.Action {
	return chromedp.ActionFunc(func(ctx context.Context) error {
		_, _, _, err := page.Navigate(urlstr).Do(ctx)
		return err
	})
}

func main() {
	extPath := os.Getenv("EXT_PATH")
	if extPath == "" {
		if wd, err := os.Getwd(); err == nil && (strings.HasSuffix(wd, "aa-hotels-mpd") || strings.HasSuffix(wd, "screenshots")) {
			if strings.HasSuffix(wd, "screenshots") {
				extPath = filepath.Dir(filepath.Dir(wd))
			} else {
				extPath = wd
			}
		} else {
			extPath = "/home/adam/bernot-dev/aa-hotels-mpd"
		}
	}
	imagesDir := filepath.Join(extPath, "images")

	opts := append(chromedp.DefaultExecAllocatorOptions[:],
		chromedp.ExecPath("/usr/bin/chromium"),
		chromedp.Flag("headless", "new"),
		chromedp.Flag("disable-extensions-except", extPath),
		chromedp.Flag("load-extension", extPath),
		chromedp.Flag("window-size", "1280,800"),
		chromedp.Flag("no-sandbox", true),
		chromedp.Flag("disable-dev-shm-usage", true),
		chromedp.Flag("disable-blink-features", "AutomationControlled"),
		chromedp.Flag("user-agent", "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36"),
	)

	allocCtx, cancel := chromedp.NewExecAllocator(context.Background(), opts...)
	defer cancel()

	searchURL := "https://search.aadvantagehotels.com/search?cid=1951050&city=8683&checkIn=2026-11-12&los=2&rooms=1&adults=2&textToSearch=Dallas+(TX)&loyaltySearchType=EARN"

	var extID string
	var firstHotelHref string

	// ==========================================
	// TAB 1: Search Page & Card Capture
	// ==========================================
	fmt.Println("=== [1/4] Capturing Search Page & Card ===")
	{
		tabCtx, tabCancel := chromedp.NewContext(allocCtx)
		tabCtx, cancelTimeout := context.WithTimeout(tabCtx, 45*time.Second)

		var searchBuf []byte
		var cardBuf []byte
		var cardSelector string

		err := chromedp.Run(tabCtx,
			chromedp.ActionFunc(func(ctx context.Context) error {
				return network.SetExtraHTTPHeaders(network.Headers{
					"Accept-Language": "en-US,en;q=0.9",
				}).Do(ctx)
			}),
			navigateFast(searchURL),
			chromedp.Sleep(10*time.Second),
			chromedp.ActionFunc(func(ctx context.Context) error {
				targets, err := chromedp.Targets(ctx)
				if err != nil {
					return err
				}
				for _, t := range targets {
					if strings.HasPrefix(t.URL, "chrome-extension://") {
						u, err := url.Parse(t.URL)
						if err == nil && u.Host != "" {
							extID = u.Host
							fmt.Printf("Found Extension ID: %s (from %s)\n", extID, t.URL)
							break
						}
					}
				}
				return nil
			}),
			chromedp.Evaluate(`
				(() => {
					const link = document.querySelector('a[href*="/hotel/"]');
					return link ? link.href : '';
				})()
			`, &firstHotelHref),
			chromedp.Evaluate(`
				(() => {
					const fakeNames = ['The Grand Royal Hotel', 'Classic Luxury Suites', 'The Metropolitan Plaza', 'Royal Park Resort'];
					document.querySelectorAll('[data-element-name="property-info-header"] a, [data-element-name="property-info-header"] h3').forEach((el, idx) => {
						if (idx < fakeNames.length) el.textContent = fakeNames[idx];
					});
					document.querySelector('[data-testid="primary-promotion-banner-description"]')?.closest('div[class*="Box"]')?.remove();
					const sortBtn = document.getElementById('aa-mpd-sort-button');
					if (sortBtn) sortBtn.setAttribute('aria-current', 'true');
				})()
			`, nil),
			chromedp.Sleep(1*time.Second),
			set1280x800(),
			chromedp.CaptureScreenshot(&searchBuf),
			chromedp.Evaluate(`
				(() => {
					const chip = document.querySelector('.aa-mpd-chip');
					if (!chip) return '';
					const card = chip.closest('li, [data-selenium="hotel-item"], [data-element-name="property-card"]') || chip.parentElement;
					if (card) {
						card.setAttribute('data-screenshot-target', 'card');
						return '[data-screenshot-target="card"]';
					}
					return '';
				})()
			`, &cardSelector),
		)

		if err != nil {
			log.Printf("Search run failed: %v", err)
		} else {
			_ = os.WriteFile(filepath.Join(imagesDir, "search-screenshot.png"), searchBuf, 0644)
			fmt.Println("Saved images/search-screenshot.png (1280x800)")

			if cardSelector != "" {
				err = chromedp.Run(tabCtx, chromedp.Screenshot(cardSelector, &cardBuf, chromedp.ByQuery))
				if err != nil {
					log.Printf("Card screenshot failed: %v", err)
				} else {
					_ = os.WriteFile(filepath.Join(imagesDir, "card-screenshot.png"), cardBuf, 0644)
					fmt.Println("Saved images/card-screenshot.png")
				}
			}
		}

		cancelTimeout()
		tabCancel()
	}

	fmt.Printf("Extension ID: %s\nFirst Hotel URL: %s\n", extID, firstHotelHref)

	// ==========================================
	// TAB 2: Details Page Capture
	// ==========================================
	if firstHotelHref != "" {
		fmt.Println("=== [2/4] Capturing Details Page ===")
		tabCtx, tabCancel := chromedp.NewContext(allocCtx)
		tabCtx, cancelTimeout := context.WithTimeout(tabCtx, 45*time.Second)

		var detailsBuf []byte
		err := chromedp.Run(tabCtx,
			chromedp.ActionFunc(func(ctx context.Context) error {
				return network.SetExtraHTTPHeaders(network.Headers{
					"Accept-Language": "en-US,en;q=0.9",
				}).Do(ctx)
			}),
			navigateFast(firstHotelHref),
			chromedp.Sleep(10*time.Second),
			chromedp.Evaluate(`
				(() => {
					const title = document.querySelector('[data-selenium="hotel-header-name"], h1, [data-element-name="property-header-name"]');
					if (title) title.textContent = 'The Grand Royal Hotel';

					document.querySelectorAll('input').forEach(i => {
						if (i.value && i.value.toLowerCase().includes('magnolia')) {
							i.value = 'The Grand Royal Hotel';
						}
					});

					const summary = document.getElementById('aa-mpd-details-summary');
					if (summary) {
						summary.scrollIntoView({ behavior: 'instant', block: 'start' });
						window.scrollBy(0, -60);
					} else {
						const rooms = document.querySelector('[data-selenium="room-grid"], [data-selenium="master-room"]');
						if (rooms) rooms.scrollIntoView({ behavior: 'instant', block: 'center' });
					}
				})()
			`, nil),
			chromedp.Sleep(1*time.Second),
			set1280x800(),
			chromedp.CaptureScreenshot(&detailsBuf),
		)
		if err != nil {
			log.Printf("Details run failed: %v", err)
		} else {
			_ = os.WriteFile(filepath.Join(imagesDir, "details-screenshot.png"), detailsBuf, 0644)
			fmt.Println("Saved images/details-screenshot.png (1280x800)")
		}

		cancelTimeout()
		tabCancel()
	}

	// ==========================================
	// TAB 3: Map View Capture
	// ==========================================
	fmt.Println("=== [3/4] Capturing Map View ===")
	{
		tabCtx, tabCancel := chromedp.NewContext(allocCtx)
		tabCtx, cancelTimeout := context.WithTimeout(tabCtx, 60*time.Second)

		var mapBuf []byte
		var clickStatus string

		err := chromedp.Run(tabCtx,
			chromedp.ActionFunc(func(ctx context.Context) error {
				return network.SetExtraHTTPHeaders(network.Headers{
					"Accept-Language": "en-US,en;q=0.9",
				}).Do(ctx)
			}),
			navigateFast(searchURL),
			chromedp.Sleep(10*time.Second),
			chromedp.Evaluate(`
				(() => {
					const btn = document.querySelector('[data-element-name="static-map-container"] button, button.static-map-button') ||
								Array.from(document.querySelectorAll('button')).find(b => b.textContent && b.textContent.includes('Show on map'));
					if (btn) {
						btn.click();
						return 'clicked map button';
					}
					return 'map button not found';
				})()
			`, &clickStatus),
			chromedp.Sleep(8*time.Second),
			chromedp.Evaluate(`
				(() => {
					const fakeNames = ['The Grand Royal Hotel', 'Classic Luxury Suites', 'The Metropolitan Plaza', 'Royal Park Resort'];
					let idx = 0;
					document.querySelectorAll('[data-selenium="hotel-name"], [data-element-name="property-card-title"], .PropertyCardItem__Name, [data-testid="hotel-name"], h3, h4').forEach((el) => {
						if (el.textContent && (el.textContent.includes('Magnolia') || el.textContent.includes('Crowne') || el.textContent.includes('Dallas'))) {
							if (idx < fakeNames.length) {
								el.textContent = fakeNames[idx++];
							}
						}
					});
				})()
			`, nil),
			chromedp.Sleep(1*time.Second),
			set1280x800(),
			chromedp.CaptureScreenshot(&mapBuf),
		)
		fmt.Printf("Map click status: %s\n", clickStatus)
		if err != nil {
			log.Printf("Map run failed: %v", err)
		} else {
			_ = os.WriteFile(filepath.Join(imagesDir, "maps-screenshot.png"), mapBuf, 0644)
			fmt.Println("Saved images/maps-screenshot.png (1280x800)")
		}

		cancelTimeout()
		tabCancel()
	}

	// ==========================================
	// TAB 4: Options Dashboard Capture
	// ==========================================
	if extID != "" {
		fmt.Println("=== [4/4] Capturing Options Dashboard ===")
		optionsURL := fmt.Sprintf("chrome-extension://%s/options.html", extID)
		tabCtx, tabCancel := chromedp.NewContext(allocCtx)
		tabCtx, cancelTimeout := context.WithTimeout(tabCtx, 30*time.Second)

		var optionsBuf []byte
		err := chromedp.Run(tabCtx,
			navigateFast(optionsURL),
			chromedp.Sleep(2*time.Second),
			chromedp.Evaluate(`
				(async () => {
					const loc1 = 'Dallas, TX, USA';
					const batches = [
						{
							criteria: {
								location: loc1,
								checkIn: '2026-11-12',
								checkOut: '2026-11-14',
								nights: 2,
								rooms: 1,
								guests: 2,
								timestamp: new Date().toISOString(),
								url: 'live-session',
							},
							rates: [
								{
									hotelName: 'The Grand Royal Hotel',
									location: loc1,
									neighborhood: 'Downtown',
									country: 'United States',
									price: 536,
									basePrice: 460,
									allInPrice: 536,
									miles: 13400,
									mpd: 25.0,
									isTotalPrice: true,
									isBonus: false,
									stars: 5,
									rating: 9.5,
									reviewCount: 1420,
									refundable: true,
									chain: 'Marriott',
									imageUrl: 'https://pix8.agoda.net/hotelImages/2461695/0/e90506a04b7c645d50edac45ea232e63.jpeg?va=1',
								},
								{
									hotelName: 'Classic Luxury Suites',
									location: loc1,
									neighborhood: 'Uptown',
									country: 'United States',
									price: 680,
									basePrice: 580,
									allInPrice: 680,
									miles: 15640,
									mpd: 23.0,
									isTotalPrice: true,
									isBonus: false,
									stars: 5,
									rating: 9.3,
									reviewCount: 1180,
									refundable: true,
									chain: 'Hilton',
									imageUrl: 'https://pix8.agoda.net/hotelImages/7453561/0/b193475649e9d908d125bab30c23a7cb.jpg?va=1',
								},
								{
									hotelName: 'The Metropolitan Plaza',
									location: loc1,
									neighborhood: 'Arts District',
									country: 'United States',
									price: 420,
									basePrice: 360,
									allInPrice: 420,
									miles: 8400,
									mpd: 20.0,
									isTotalPrice: true,
									isBonus: false,
									stars: 4.5,
									rating: 9.1,
									reviewCount: 890,
									refundable: true,
									chain: 'Hyatt',
									imageUrl: 'https://pix8.agoda.net/hotelImages/7453561/0/5131dd283e0c5a41c4e0da86872f9360.jpg?va=1',
								},
							],
						},
					];
					for (const b of batches) {
						await new Promise((resolve) => {
							chrome.runtime.sendMessage({ type: 'RECORD_RATES', criteria: b.criteria, rates: b.rates }, () => resolve(true));
						});
					}
				})()
			`, nil),
			chromedp.Sleep(1*time.Second),
			chromedp.Reload(),
			chromedp.Sleep(2*time.Second),
			set1280x800(),
			chromedp.CaptureScreenshot(&optionsBuf),
		)
		if err != nil {
			log.Printf("Options run failed: %v", err)
		} else {
			_ = os.WriteFile(filepath.Join(imagesDir, "options-dashboard-screenshot.png"), optionsBuf, 0644)
			fmt.Println("Saved images/options-dashboard-screenshot.png (1280x800)")
		}

		cancelTimeout()
		tabCancel()
	}

	fmt.Println("All screenshot captures complete!")
}
