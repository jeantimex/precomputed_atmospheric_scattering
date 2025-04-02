/**
 * TouchManager class for handling touch interactions
 * Provides methods for handling touch gestures and updating the atmosphere accordingly
 * Optimized for mobile devices with support for pinch-to-zoom and two-finger swipe
 */
export class TouchManager {
  /**
   * Creates a new touch controls manager
   * @param {Atmosphere} atmosphere - The atmosphere instance to control
   */
  constructor(atmosphere) {
    this.atmosphere = atmosphere;
    this.renderer = atmosphere.renderer;

    // For pinch-to-zoom and two-finger gestures
    this.previousTouchDistance = 0;
    this.activeTouches = [];
    this.previousTouchY = 0;
    this.twoFingerMode = null; // Can be 'zoom' or 'swipe'
    this.gestureDetectionThreshold = 10; // Pixels to determine gesture type

    // Set up touch event listeners
    this.setupTouchEvents();
  }

  /**
   * Set up touch event listeners
   */
  setupTouchEvents() {
    // For pinch-to-zoom on touch devices
    this.renderer.domElement.addEventListener(
      "touchstart",
      this.onTouchStart.bind(this),
      { passive: false }
    );
    this.renderer.domElement.addEventListener(
      "touchmove",
      this.onTouchMove.bind(this),
      { passive: false }
    );
    this.renderer.domElement.addEventListener(
      "touchend",
      this.onTouchEnd.bind(this),
      { passive: false }
    );
  }

  /**
   * Handle touch start event for multi-touch gestures
   * @param {TouchEvent} event - The touch event
   */
  onTouchStart(event) {
    // Prevent default to avoid page scrolling
    event.preventDefault();

    // Store touch points
    this.activeTouches = Array.from(event.touches);

    // Reset gesture mode
    this.twoFingerMode = null;

    if (this.activeTouches.length === 2) {
      const touch1 = this.activeTouches[0];
      const touch2 = this.activeTouches[1];

      // Calculate initial distance between two touch points for pinch-to-zoom
      this.previousTouchDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      // Store the average Y position for detecting vertical swipes
      this.previousTouchY = (touch1.clientY + touch2.clientY) / 2;

      // Cancel any existing drag operation when two fingers are used
      // Use the PointerManager's resetDrag method instead of directly modifying atmosphere.drag
      if (this.atmosphere.pointerManager) {
        this.atmosphere.pointerManager.resetDrag();
      }
    }
  }

  /**
   * Handle touch move event for multi-touch gestures
   * @param {TouchEvent} event - The touch event
   */
  onTouchMove(event) {
    // Prevent default to avoid page scrolling
    event.preventDefault();

    // Handle two-finger gestures
    if (event.touches.length === 2) {
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];

      // Calculate current distance between touch points
      const currentDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );

      // Calculate current average Y position
      const currentTouchY = (touch1.clientY + touch2.clientY) / 2;

      // Calculate changes in distance and position
      const deltaDistance = Math.abs(
        currentDistance - this.previousTouchDistance
      );
      const deltaY = Math.abs(currentTouchY - this.previousTouchY);

      // If gesture mode isn't determined yet, determine it based on initial movement
      if (!this.twoFingerMode) {
        if (
          deltaDistance > this.gestureDetectionThreshold &&
          deltaDistance > deltaY
        ) {
          this.twoFingerMode = "zoom";
        } else if (
          deltaY > this.gestureDetectionThreshold &&
          deltaY > deltaDistance
        ) {
          this.twoFingerMode = "swipe";
        }
      }

      // Apply the appropriate gesture behavior
      if (this.twoFingerMode === "zoom") {
        // Pinch-to-zoom behavior
        if (this.previousTouchDistance > 0) {
          // Calculate zoom factor based on the change in distance
          const zoomFactor = currentDistance / this.previousTouchDistance;

          // Apply zoom (pinch in = zoom out, pinch out = zoom in)
          this.atmosphere.viewDistanceMeters /= zoomFactor;
          this.atmosphere.updateCameraPosition();
        }
        this.previousTouchDistance = currentDistance;
      } else if (this.twoFingerMode === "swipe") {
        // Two-finger vertical swipe behavior - adjust camera tilt (zenith angle)
        // Increase the sensitivity for two-finger swipe to match one-finger behavior
        const kTiltScale = 0.015; // Increased from 0.005 to make it more responsive
        const deltaTilt = (currentTouchY - this.previousTouchY) * kTiltScale;

        // Update camera tilt (zenith angle)
        this.atmosphere.viewZenithAngleRadians -= deltaTilt;

        // Clamp the zenith angle to prevent flipping or looking too far down
        // Expanded the range slightly to allow more movement
        this.atmosphere.viewZenithAngleRadians = Math.max(
          0,
          Math.min(Math.PI / 2 - 0, this.atmosphere.viewZenithAngleRadians)
        );

        // Update camera position
        this.atmosphere.updateCameraPosition();

        this.previousTouchY = currentTouchY;
      }
    }
  }

  /**
   * Handle touch end event
   * @param {TouchEvent} event - The touch event
   */
  onTouchEnd(event) {
    // Prevent default behavior
    event.preventDefault();

    this.activeTouches = Array.from(event.touches);
    this.previousTouchDistance = 0;
    this.twoFingerMode = null;
  }
}
