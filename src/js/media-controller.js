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
import { 
  MEDIA_PLAY_REQUEST,
  MEDIA_PAUSE_REQUEST,
  MEDIA_MUTE_REQUEST,
  MEDIA_UNMUTE_REQUEST,
  MEDIA_VOLUME_REQUEST,
  MEDIA_ENTER_FULLSCREEN_REQUEST,
  MEDIA_EXIT_FULLSCREEN_REQUEST,
  MEDIA_SEEK_REQUEST,
  MEDIA_PREVIEW_REQUEST,
  MEDIA_ENTER_PIP_REQUEST,
  MEDIA_EXIT_PIP_REQUEST,
  MEDIA_PLAYBACK_RATE_REQUEST,
} from './media-ui-events.js';
import { fullscreenApi } from './utils/fullscreenApi.js';

const template = document.createElement('template');

template.innerHTML = `
  <style>
    :host {
      box-sizing: border-box;
      position: relative;

      /* Position controls at the bottom  */
      display: flex;
      flex-direction: column-reverse;

      /* Default dimensions */
      width: 100%;
      max-width: 720px;
      height: 480px;
      background-color: #000;
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

    [media-test] #container {
      display:none !important;
    }

    #container.inactive:not(.paused) ::slotted(*) {
      opacity: 0;
      transition: opacity 1s;
    }
  </style>
  <slot name="media"></slot>
  <div id="container">
    <slot></slot>
  </div>
`;

/*
  Loop through child nodes and set the media[State] on every child.
*/
function propagateMediaState(nodeList, stateName, val) {
  Array.from(nodeList).forEach(child => {
    // All elements we care about at least have an empty children list (i.e. not <style>)
    if (!child.children) return;

    const childName = child.nodeName.toLowerCase();

    // Don't propagate into media elements, UI can't live in <video>
    // so just avoid potential conflicts
    if (child.slot == 'media') return;

    function setAndPropagate() {
      // Only set if previously defined, at least as null
      // This is how element authors can tell us they want to
      // receive these state updates
      if (typeof child[stateName] !== 'undefined') {
        child[stateName] = val;
      }

      propagateMediaState(child.children, stateName, val);

      // We might consider an option to block piercing the shadow dom
      if (child.shadowRoot) propagateMediaState(child.shadowRoot.childNodes, stateName, val);
    }

    // Make sure custom els are ready
    if (childName.includes('-') && !window.customElements.get(childName)) {
      window.customElements.whenDefined(childName).then(setAndPropagate);
    } else {
      setAndPropagate();
    }
  });
}

class MediaController extends window.HTMLElement {
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

    // Track externally associated control elements
    this.associatedElements = [];

    // Capture requests from internal control events
    this.addEventListener(MEDIA_PLAY_REQUEST, (e) => {
      e.stopPropagation();
      this.media && this.media.play();
    });
  
    this.addEventListener(MEDIA_PAUSE_REQUEST, (e) => {
      e.stopPropagation();
      this.media && this.media.pause();
    });

    this.addEventListener(MEDIA_MUTE_REQUEST, (e) => {
      e.stopPropagation();
      if (this.media) this.media.muted = true;
    });

    this.addEventListener(MEDIA_UNMUTE_REQUEST, (e) => {
      e.stopPropagation();
      const media = this.media;

      if (!media) return;

      media.muted = false;

      // Avoid confusion by bumping the volume on unmute
      if (media.volume === 0) {
        media.volume = 0.25;
      }
    });

    this.addEventListener(MEDIA_VOLUME_REQUEST, (e) => {
      const media = this.media;
      const volume = e.detail;

      e.stopPropagation();

      if (!media) return;

      media.volume = volume;

      // If the viewer moves the volume we should unmute for them.
      if (volume > 0 && media.muted) {
        media.muted = false;
      }

      // Store the last set volume as a local preference, if ls is supported
      try {
        window.localStorage.setItem(
          'media-chrome-pref-volume',
          volume.toString()
        );
      } catch (e) {}
    });

    // This current assumes that the media controller is the fullscreen element
    // which may be true in most cases but not all.
    // The prior version of media-chrome support alt fullscreen elements
    // and that's something we can work towards here
    this.addEventListener(MEDIA_ENTER_FULLSCREEN_REQUEST, (e) => {
      e.stopPropagation();
      
      if (document.pictureInPictureElement) {
        // Should be async
        document.exitPictureInPicture();
      }

      this[fullscreenApi.enter]();
    });

    this.addEventListener(MEDIA_EXIT_FULLSCREEN_REQUEST, (e) => {
      e.stopPropagation();
      document[fullscreenApi.exit]();
    });

    this.addEventListener(MEDIA_ENTER_PIP_REQUEST, (e) => {
      e.stopPropagation();

      const docOrRoot = this.getRootNode();
      const media = this.media;

      if (!docOrRoot.pictureInPictureEnabled) return;

      // Exit fullscreen if needed
      if (docOrRoot[fullscreenApi.element]) {
        docOrRoot[fullscreenApi.exit]();
      }

      media.requestPictureInPicture();
    });

    this.addEventListener(MEDIA_EXIT_PIP_REQUEST, (e) => {
      e.stopPropagation();

      const docOrRoot = this.getRootNode();
      if (docOrRoot.exitPictureInPicture) docOrRoot.exitPictureInPicture();
    });

    this.addEventListener(MEDIA_SEEK_REQUEST, (e) => {
      e.stopPropagation();

      const media = this.media;
      const time = e.detail;

      if (!media) return;

      // Can't set the time before the media is ready
      // Ignore if readyState isn't supported
      if (media.readyState > 0 || media.readyState === undefined) {
        media.currentTime = time;
      }
    });

    this.addEventListener(MEDIA_PLAYBACK_RATE_REQUEST, (e) => {
      e.stopPropagation();

      const media = this.media;

      if (media) media.playbackRate = e.detail;
    });

    this.addEventListener(MEDIA_PREVIEW_REQUEST, (e) => {
      e.stopPropagation();

      const time = e.detail;
      const media = this.media;

      if (media && media.textTracks && media.textTracks.length) {
        let track = Array.prototype.find.call(media.textTracks, (t)=>{
          return t.label == 'thumbnails';
        });
  
        if (!track) return;
        if (!track.cues) return;
  
        let cue = Array.prototype.find.call(track.cues, c => c.startTime >= time);
  
        if (cue) {
          const url = new URL(cue.text);
          const [x,y,w,h] = url.hash.split('=')[1].split(',');
          const src = url.origin + url.pathname;
  
          this.propagateMediaState('mediaPreviewImage', src);
          this.propagateMediaState('mediaPreviewCoords', `${x},${y},${w},${h}`);
        }
      }
    });
  }

  // First direct child with slot=media, or null
  get media() {
    return this.querySelector(':scope > [slot=media]');
  }

  mediaSetCallback(media) {
    // Should only ever be set with a compatible media element, never null
    if (!media || !media.play) {
      console.error('<media-chrome>: Media element set with slot="media" does not appear to be compatible.', media);
      return;
    }

    // Wait until custom media elements are ready
    const mediaName = media.nodeName.toLowerCase();

    if (mediaName.includes('-') && !window.customElements.get(mediaName)) {
      window.customElements.whenDefined(mediaName).then(()=>{
        this.mediaSetCallback(media);
      });
      return;
    }

    // Listen for state changes and propagate them to children and associated els
    this._propagatePausedState = () => {
      this.propagateMediaState('mediaPaused', media.paused);
    };
    media.addEventListener('play', this._propagatePausedState);
    media.addEventListener('pause', this._propagatePausedState);
    this._propagatePausedState();

    // Volume updates
    this._propagateVolume = () => {
      const { muted, volume } = media;

      let level = 'high';
      if (volume == 0 || muted) {
        level = 'off';
      } else if (volume < 0.5) {
        level = 'low';
      } else if (volume < 0.75) {
        level = 'medium';
      }

      this.propagateMediaState('mediaMuted', muted);
      this.propagateMediaState('mediaVolume', volume);
      this.propagateMediaState('mediaVolumeLevel', level);
    };
    media.addEventListener('volumechange', this._propagateVolume);
    this._propagateVolume();

    // Fullscreen updates
    this._propagateFullscreenState = () => {
      // Might be in the shadow dom
      const fullscreenEl = this.getRootNode()[fullscreenApi.element];
      this.propagateMediaState('mediaIsFullscreen', fullscreenEl == this);
    };
    document.addEventListener(fullscreenApi.event, this._propagateFullscreenState);
    this._propagateFullscreenState();

    // PIP updates
    this._propagatePipState = (e) => {
      // Rely on event type for state first
      // in case this doesn't work well for custom elements using internal <video>
      if (e) {
        const isPip = e.type == 'enterpictureinpicture';
        this.propagateMediaState('mediaIsPip', isPip);
      } else {
        const docOrRoot = this.getRootNode();
        this.propagateMediaState('mediaIsPip', media == docOrRoot.pictureInPictureElement);
      }
    };
    media.addEventListener('enterpictureinpicture', this._propagatePipState);
    media.addEventListener('leavepictureinpicture', this._propagatePipState);
    this._propagatePipState();

    // Time updates
    this._propagateCurrentTime = () => {
      this.propagateMediaState('mediaCurrentTime', media.currentTime);
    };
    media.addEventListener('timeupdate', this._propagateCurrentTime);
    media.addEventListener('loadedmetadata', this._propagateCurrentTime);
    this._propagateCurrentTime();

    // Duration updates
    this._propagateDuration = () => {
      this.propagateMediaState('mediaDuration', media.duration);
    };
    media.addEventListener('durationchange', this._propagateDuration);
    media.addEventListener('loadedmetadata', this._propagateDuration);
    this._propagateDuration();

    // Rate updates
    this._propagateRate = () => {
      this.propagateMediaState('mediaPlaybackRate', media.playbackRate);
    };
    media.addEventListener('ratechange', this._propagateRate);
    this._propagateRate();


    // Auto-show/hide controls
    // Todo: Move this to using a media-paused attribute
    if (media.paused) {
      this.container.classList.add('paused');
    }
    this._mediaPlayHandler = e => {
      this.container.classList.remove('paused');
    };
    media.addEventListener('play', this._mediaPlayHandler);

    this._mediaPauseHandler = e => {
      this.container.classList.add('paused');
    };
    media.addEventListener('pause', this._mediaPauseHandler);

    // Toggle play/pause with clicks on the media element itself
    this._mediaClickPlayToggle = e => {
      if (media.paused) {
        media.play();
      } else {
        media.pause();
      }
    }
    media.addEventListener('click', this._mediaClickPlayToggle, false);

    // Update the media with the last set volume preference
    // This would preferably live with the media element,
    // not a control.
    try {
      const volPref = window.localStorage.getItem('media-chrome-pref-volume');
      if (volPref !== null) media.volume = volPref;
    } catch (e) { }
  }

  mediaUnsetCallback(media) {
    media.removeEventListener('play', this._propagatePausedState);
    media.removeEventListener('pause', this._propagatePausedState);
    media.removeEventListener('volumechange', this._propagateVolume);
    media.removeEventListener('timeupdate', this._propagateCurrentTime);
    media.removeEventListener('loadedmetadata', this._propagateCurrentTime);
    media.removeEventListener('durationchange', this._propagateDuration);
    media.removeEventListener('loadedmetadata', this._propagateDuration);
    document.removeEventListener(fullscreenApi.event, this._handleDocFullscreenChanges);

    media.removeEventListener('click', this._mediaClickPlayToggle);
    media.removeEventListener('play', this._mediaPlayHandler);
    media.removeEventListener('pause', this._mediaPauseHandler);

    // Unhide controls
    this.container.classList.add('paused');
  }

  propagateMediaState(stateName, state) {
    propagateMediaState(this.children, stateName, state);
    propagateMediaState(this.associatedElements, stateName, state);
  }

  connectedCallback() {
    if (this.media) {
      this.mediaSetCallback(this.media);
    }

    const scheduleInactive = () => {
      this.container.classList.remove('inactive');
      window.clearTimeout(this.inactiveTimeout);
      this.inactiveTimeout = window.setTimeout(() => {
        this.container.classList.add('inactive');
      }, 2000);
    };

    // Unhide for keyboard controlling
    this.addEventListener('keyup', e => {
      scheduleInactive();
    });

    // Allow for focus styles only when using the keyboard to navigate
    this.addEventListener('keyup', e => {
      this.container.classList.add('media-focus-visible');
    });
    this.addEventListener('mouseup', e => {
      this.container.classList.remove('media-focus-visible');
    });

    this.addEventListener('mousemove', e => {
      if (e.target === this) return;

      // Stay visible if hovered over control bar
      this.container.classList.remove('inactive');
      window.clearTimeout(this.inactiveTimeout);

      // If hovering over the media element we're free to make inactive
      if (e.target === this.media) {
        scheduleInactive();
      }
    });

    // Immediately hide if mouse leaves the container
    this.addEventListener('mouseout', e => {
      this.container.classList.add('inactive');
    });
  }

  associateElement(el) {
    this.associatedElements.push(el);

    // Could just attach all releveant listeners to every associated el
    // or could use the `on${eventName}` prop detection method to know
    // which events the el intends to dispatch
    // The latter requires authors to actually follow that paradigm
    // which is probably a stretch
    el.addEventListener(MEDIA_PLAY_REQUEST, this._handlePlayRequest);
    el.addEventListener(MEDIA_PAUSE_REQUEST, this._handlePauseRequest);

    propagateMediaState([el], 'mediaPaused', this.media.paused);
  }

  unassociateElement(el) {
    els = this.associatedElements;

    const index = els.indexOf(el);
    if (index > -1) {
      els.splice(index, 1);
    }

    el.removeEventListener(MEDIA_PLAY_REQUEST, this._handlePlayRequest);
    el.removeEventListener(MEDIA_PAUSE_REQUEST, this._handlePauseRequest);
  }
}

defineCustomElement('media-controller', MediaController);

export default MediaController;
