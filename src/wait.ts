export const waitForElement = (elementSelector: string): Promise<Element> => {
	return new Promise(resolve => {
		let elem = document.querySelector(elementSelector);
		if (elem) {
			return resolve(elem);
		}

		const observer = new MutationObserver(() => {
			elem = document.querySelector(elementSelector);
		
			if (elem) {
				observer.disconnect();
				resolve(elem);
			}
		});
		observer.observe(document.body, {childList: true, subtree: true});
	})
}
