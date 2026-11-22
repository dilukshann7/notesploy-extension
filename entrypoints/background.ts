import { browser } from 'wxt/browser';
import { resumePending, saveFallback, saveHighlight, saveImage, saveLink } from '../src/lib/actions';
import { threadUrl } from '../src/lib/config';
import { handleMessage, type PopupMessage } from '../src/lib/messages';

const MENUS = [
  { id: 'menu-save-page', title: 'Save page to Notesploy', contexts: ['page'] },
  { id: 'menu-save-link', title: 'Save link to Notesploy', contexts: ['link'] },
  { id: 'menu-save-highlight', title: 'Save highlight to Notesploy', contexts: ['selection'] },
  { id: 'menu-save-image', title: 'Save image to Notesploy', contexts: ['image'] },
] as const;

async function registerContextMenus(): Promise<void> {
  await browser.contextMenus.removeAll();
  for (const menu of MENUS) {
    browser.contextMenus.create({ id: menu.id, title: menu.title, contexts: [...menu.contexts] });
  }
}

async function activeTab() {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  return tab;
}

export default defineBackground(() => {
  browser.runtime.onInstalled.addListener(() => void registerContextMenus());
  browser.runtime.onStartup.addListener(() => void registerContextMenus());

  browser.contextMenus.onClicked.addListener((info, tab) => {
    const tabId = tab?.id;
    switch (info.menuItemId) {
      case 'menu-save-page':
        void saveLink(tab?.url, tabId);
        break;
      case 'menu-save-link':
        void saveLink(info.linkUrl, tabId);
        break;
      case 'menu-save-highlight':
        void saveHighlight({ text: info.selectionText, sourceUrl: tab?.url, title: tab?.title, tabId });
        break;
      case 'menu-save-image':
        void saveImage(info.srcUrl, tabId);
        break;
    }
  });

  browser.commands.onCommand.addListener(async (command) => {
    if (command !== 'save-page') return;
    const tab = await activeTab();
    await saveLink(tab?.url, tab?.id);
  });

  browser.runtime.onMessage.addListener((message: PopupMessage, _sender, sendResponse) => {
    void handleMessage(message).then(sendResponse);
    return true;
  });

  browser.notifications.onClicked.addListener((id) => {
    if (id.startsWith('thread:')) void browser.tabs.create({ url: threadUrl(id.slice('thread:'.length)) });
  });

  browser.notifications.onButtonClicked.addListener((id, buttonIndex) => {
    if (!id.startsWith('fallback:') || buttonIndex !== 0) return;
    // Works only if the page is still granted to the extension; otherwise the popup offers the same action.
    void saveFallback().then((result) => {
      if (result && !result.ok) {
        void browser.notifications.create(`fallback-error:${Date.now()}`, {
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          title: "Couldn't save what you see",
          message: result.message,
        });
      }
    });
  });

  // Resume polling for captures that were in flight when the worker last stopped.
  void resumePending();
});
