/*
  The <media-chrome> can contain the control elements
  and the media element. Features:
  * Auto-set the `media` attribute on child media chrome elements
    * Uses the element with slot="media"
  * Take custom controls to fullscreen
  * Position controls at the bottom
  * Auto-hide controls on inactivity while playing
*/
import { defineCustomElement } from './utils/defineCustomElement.js';
import { Window as window, Document as document } from './utils/server-safe-globals.js';
import { MediaChromeHTMLElement, mediaUIEvents } from './media-chrome-html-element.js';

const template = document.createElement('template');

template.innerHTML = `
  <style>
    :host {
      box-sizing: border-box;
      position: relative;

      /* Position controls at the bottom  */
      display: flex;
      flex-direction: column-reverse;

      /* Default dimensions
       * max out at 100% width for smaller screens (< 720px)
       * */
      max-width: 100%;
      background-color: #000;
    }

    /* Video specific styles */
    :host(:not([audio])) {
      height: 480px;
      width: 720px;
    }

    /* Safari needs this to actually make the element fill the window */
    :host(:-webkit-full-screen) {
      /* Needs to use !important otherwise easy to break */
      width: 100% !important;
      height: 100% !important;
    }

    /* Position the media element to fill the container */
    ::slotted([slot=media]) {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
    }

    /* Hide controls when inactive and not paused */
    #container ::slotted(*) {
      opacity: 1;
      transition: opacity 0.25s;
      visibility: visible;
    }

    :host([user-inactive]:not([media-paused])) #container ::slotted(*) {
      opacity: 0;
      transition: opacity 1s;
    }

    #container ::slotted(media-control-bar)  {
      width: 100%;
    }
  </style>
  <slot name="media"></slot>
  <div id="container">
    <slot></slot>
  </div>
`;

class MediaContainer extends MediaChromeHTMLElement {
  constructor() {
    super();

    // Set up the Shadow DOM
    const shadow = this.attachShadow({ mode: 'open' });
    this.shadowRoot.appendChild(template.content.cloneNode(true));
    this.container = this.shadowRoot.getElementById('container');

    // Watch for child adds/removes and update the media element if necessary
    const mutationCallback = (mutationsList, observer) => {
      const media = this.media;

      for (let mutation of mutationsList) {
        if (mutation.type === 'childList') {

          // Media element being removed
          mutation.removedNodes.forEach(node => {
            // Is this a direct child media element of media-controller?
            // TODO: This accuracy doesn't matter after moving away from media attrs.
            // Could refactor so we can always just call 'dispose' on any removed media el.
            if (node.slot == 'media' && mutation.target == this) {
              // Check if this was the current media by if it was the first
              // el with slot=media in the child list. There could be multiple.
              let previousSibling = mutation.previousSibling && mutation.previousSibling.previousElementSibling;

              // Must have been first if no prev sibling or new media
              if (!previousSibling || !media) {
                this.mediaUnsetCallback(node);
              } else {
                // Check if any prev siblings had a slot=media
                // Should remain true otherwise
                let wasFirst = previousSibling.slot !== 'media';
                while ((previousSibling = previousSibling.previousSibling) !== null) {
                  if (previousSibling.slot == 'media') wasFirst = false;
                }
                if (wasFirst) this.mediaUnsetCallback(node);
              }
            }
          });

          // Controls or media element being added
          // No need to inject anything if media=null
          if (media) {
            mutation.addedNodes.forEach(node => {
              if (node == media) {
                // Update all controls with new media if this is the new media
                this.mediaSetCallback(node);
              }
            });
          }
        }
      }
    };

    const observer = new MutationObserver(mutationCallback);
    observer.observe(this, { childList: true, subtree: true });
  }

  static get observedAttributes() {
    return ['autohide'].concat(super.observedAttributes || []);
  }

  // Could share this code with media-chrome-html-element instead
  // attributeChangedCallback(attrName, oldValue, newValue) {
  //   if (attrName.toLowerCase() == 'autohide') {
  //     this.autohide = newValue;
  //   } else {
  //     super.attributeChangedCallback(attrName, oldValue, newValue);
  //   }
  // }

  // First direct child with slot=media, or null
  get media() {
    return this.querySelector(':scope > [slot=media]');
  }

  mediaSetCallback(media) {
    // Should only ever be set with a compatible media element, never null
    if (!media || !media.play) {
      console.error('<media-chrome>: Media element set with slot="media" does not appear to be compatible.', media);
      return false;
    }

    // Wait until custom media elements are ready
    const mediaName = media.nodeName.toLowerCase();

    if (mediaName.includes('-') && !window.customElements.get(mediaName)) {
      window.customElements.whenDefined(mediaName).then(()=>{
        this.mediaSetCallback(media);
      });
      return false;
    }

    // Toggle play/pause with clicks on the media element itself
    this._mediaClickPlayToggle = e => {
      if (media.paused) {
        this.dispatchMediaEvent(mediaUIEvents.MEDIA_PLAY_REQUEST);
      } else {
        this.dispatchMediaEvent(mediaUIEvents.MEDIA_PAUSE_REQUEST);
      }
    }
    media.addEventListener('click', this._mediaClickPlayToggle, false);

    return true;
  }

  mediaUnsetCallback(media) {
    media.removeEventListener('click', this._mediaClickPlayToggle);
  }

  connectedCallback() {
    if (this.media) {
      this.mediaSetCallback(this.media);
    }

    const scheduleInactive = () => {
      this.removeAttribute('user-inactive');
      window.clearTimeout(this.inactiveTimeout);

      // Setting autohide to -1 turns off autohide
      if (this.autohide < 0) return;

      this.inactiveTimeout = window.setTimeout(() => {
        this.setAttribute('user-inactive', 'user-inactive');
      }, this.autohide * 1000);
    };

    // Unhide for keyboard controlling
    this.addEventListener('keyup', e => {
      scheduleInactive();
    });

    // Allow for focus styles only when using the keyboard to navigate
    this.addEventListener('keyup', e => {
      this.setAttribute('media-keyboard-control', 'media-keyboard-control');
      // this.container.classList.add('media-focus-visible');
    });
    this.addEventListener('mouseup', e => {
      this.removeAttribute('media-keyboard-control');
      // this.container.classList.remove('media-focus-visible');
    });

    this.addEventListener('mousemove', e => {
      if (e.target === this) return;

      // Stay visible if hovered over control bar
      this.removeAttribute('user-inactive');
      window.clearTimeout(this.inactiveTimeout);

      // If hovering over the media element we're free to make inactive
      if (e.target === this.media) {
        scheduleInactive();
      }
    });

    // Immediately hide if mouse leaves the container
    this.addEventListener('mouseout', e => {
      if (this.autohide > -1) this.setAttribute('user-inactive', 'user-inactive');
    });
  }

  set autohide(seconds) {
    seconds = Number(seconds);
    this._autohide = isNaN(seconds) ? 0 : seconds;
  }

  get autohide() {
    return this._autohide === undefined ? 2 : this._autohide;
  }
}

// Aliasing media-controller to media-container in main index until we know
// we're not breaking people with the change.
defineCustomElement('media-container-temp', MediaContainer);

export default MediaContainer;
