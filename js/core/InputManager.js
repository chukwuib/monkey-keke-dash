export class InputManager {
  constructor() {
    this.actions = {};
    this.touchStart = null;
    this.minSwipeDistance = 40;
    this.callbacks = {};

    this._bindKeyboard();
    this._bindTouch();
  }

  on(action, cb) {
    this.callbacks[action] = cb;
  }

  fire(action) {
    if (this.callbacks[action]) this.callbacks[action]();
  }

  _bindKeyboard() {
    window.addEventListener('keydown', e => {
      switch (e.code) {
        case 'ArrowLeft':  case 'KeyA': this.fire('swipeLeft');  break;
        case 'ArrowRight': case 'KeyD': this.fire('swipeRight'); break;
        case 'ArrowUp':    case 'KeyW': case 'Space': this.fire('swipeUp');    break;
        case 'ArrowDown':  case 'KeyS': this.fire('swipeDown');  break;
        case 'Escape': this.fire('pause'); break;
        case 'KeyQ': this.fire('swipeFarLeft');  break; // risky lane left
        case 'KeyE': this.fire('swipeFarRight'); break; // risky lane right
      }
    });
  }

  // Is the player actively driving? (HUD is the active screen during play.)
  // We only hijack/scroll-lock touches then, so menus stay scrollable/tappable.
  _isPlaying() {
    const hud = document.getElementById('screen-hud');
    if (!hud || !hud.classList.contains('active')) return false;
    // A modal intro "scroll" sits on top of the (still-active) HUD but isn't a
    // .screen, so the HUD stays active behind it. Don't hijack/preventDefault
    // touch while it's open, or the write-up can't scroll natively on mobile.
    if (document.querySelector('.state-scroll-overlay')) return false;
    return true;
  }

  // Touch is bound to `window` (not the canvas) so no UI overlay can swallow a
  // swipe — an earlier bottom-half "swipe zone" div with pointer-events:auto
  // but no listeners used to eat every lower-screen swipe on mobile.
  _bindTouch() {
    window.addEventListener('touchstart', e => {
      const t = e.touches[0];
      this.touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
    }, { passive: true });

    // Stop the page from scrolling / pull-to-refresh mid-swipe, but only during
    // gameplay so menu lists (garage/shop) still scroll normally.
    window.addEventListener('touchmove', e => {
      if (this.touchStart && this._isPlaying()) e.preventDefault();
    }, { passive: false });

    window.addEventListener('touchend', e => {
      if (!this.touchStart) return;
      const start = this.touchStart;
      this.touchStart = null;
      // Outside gameplay, leave the touch alone (lets buttons/scroll work).
      if (!this._isPlaying()) return;

      const t = e.changedTouches[0];
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      const absDx = Math.abs(dx);
      const absDy = Math.abs(dy);

      if (Math.max(absDx, absDy) < this.minSwipeDistance) return; // a tap, not a swipe

      if (absDx > absDy) {
        // Horizontal swipe
        if (dx < 0) {
          if (absDx > this.minSwipeDistance * 2.5) this.fire('swipeFarLeft');
          else this.fire('swipeLeft');
        } else {
          if (absDx > this.minSwipeDistance * 2.5) this.fire('swipeFarRight');
          else this.fire('swipeRight');
        }
      } else {
        // Vertical swipe
        if (dy < 0) this.fire('swipeUp');
        else this.fire('swipeDown');
      }
    }, { passive: true });
  }
}
