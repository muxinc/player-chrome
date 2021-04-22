import MediaChromeHTMLElement from './media-chrome-html-element.js';
import { defineCustomElement } from './utils/defineCustomElement.js';
import { Document as document } from './utils/server-safe-globals.js';

const template = document.createElement('template');

template.innerHTML = `
<style>
  :host {
    position: relative;
    display: inline-block;
    vertical-align: middle;
    box-sizing: border-box;
    background-color: rgba(0,0,0,0.7);

    /* Default width and height can be overridden externally */
    height: 44px;
    width: 44px;

    /* Vertically center any text */
    font-size: 14px;
    line-height: 1;
    font-weight: bold;

    /* Min icon size is 24x24 */
    min-height: 24px;
    min-width: 24px;

    transition: background-color 0.15s linear;
  }

  /*
    Only show outline when keyboard focusing.
    https://drafts.csswg.org/selectors-4/#the-focus-visible-pseudo
  */
  :host-context(.media-focus-visible):host(:focus, :focus-within) {
    box-shadow: inset 0 0 0 2px rgba(27, 127, 204, 0.8);
  }

  :host(:hover) {
    background-color: rgba(0,0,0,0.5);
  }

  /* Undo the default button styles and fill the parent element */
  button {
    width: 100%;
    height: 100%;
    vertical-align: middle;
    border: none;
    margin: 0;
    padding: 0;
    text-decoration: none;
    background: transparent;
    color: #ffffff;
    font-family: sans-serif;
    font-size: 14px;
    line-height: 24px;
    font-weight: bold;
    font-family: Arial, sans-serif;
    cursor: pointer;
    text-align: center;
    -webkit-appearance: none;
    -moz-appearance: none;
  }

  button:hover {}
  button:focus {
    outline: 0;
  }
  button:active {}

  svg {
    width: var(--media-button-icon-width);
    height: var(--media-button-icon-height);
    transform: var(--media-button-icon-transform);
    transition: var(--media-button-icon-transition);
  }

  svg .icon {
    fill: var(--media-icon-color, #eee);
  }

  button:not([aria-pressed]) slot[name="pressed"],
  button[aria-pressed=false] slot[name="pressed"] {
    display: none;
  }

  button[aria-pressed=true] slot:not([name]) {
    display: none;
  }
</style>

<button></button>
`;

const defaultSlotTemplate = document.createElement('template');
defaultSlotTemplate.innerHTML = `<slot></slot>`;

class MediaChromeButton extends MediaChromeHTMLElement {
  constructor(options={}) {
    super();

    const shadow = this.attachShadow({ mode: 'open' });

    const buttonHTML = template.content.cloneNode(true);
    this.nativeEl = buttonHTML.querySelector('button');
    const slotTemplate = options.slotTemplate || defaultSlotTemplate;
    this.nativeEl.appendChild(slotTemplate.content.cloneNode(true));

    shadow.appendChild(buttonHTML);

    // Deprecate
    this.addEventListener('click', e => {
      this.onClick(e);
    });

    this.addEventListener('click', e => {
      this.handleClick(e);
    });
  }

  handleClick() {}

  // Should remove this version to avoid overwriting internal click handlers
  onClick() {}

  set icon(svg) {
    this.container.innerHTML = svg;
  }
}

defineCustomElement('media-chrome-button', MediaChromeButton);

export default MediaChromeButton;
