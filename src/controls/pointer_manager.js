import * as THREE from "three";

/**
 * PointerManager class for handling pointer events
 * Provides methods for handling mouse and pointer interactions and updating the demo accordingly
 * Handles camera movement and sun position control
 */
export class PointerManager {
  /**
   * Creates a new pointer controls manager
   * @param {Object} demo - The demo instance to control
   */
  constructor(demo) {
    this.demo = demo;
    this.renderer = demo.renderer;

    // Store initial values for camera control
    this.drag = undefined;
    this.previousPointerX = 0;
    this.previousPointerY = 0;

    // Set up pointer event listeners
    this.setupPointerEvents();
  }

  /**
   * Set up pointer event listeners
   */
  setupPointerEvents() {
    this.renderer.domElement.addEventListener(
      "pointerdown",
      this.onPointerDown.bind(this)
    );
    this.renderer.domElement.addEventListener(
      "pointermove",
      this.onPointerMove.bind(this)
    );
    this.renderer.domElement.addEventListener(
      "pointerup",
      this.onPointerUp.bind(this)
    );
    this.renderer.domElement.addEventListener(
      "pointercancel",
      this.onPointerUp.bind(this)
    );
    this.renderer.domElement.addEventListener("wheel", this.onWheel.bind(this));
  }

  /**
   * Reset the drag state
   * This method allows other managers (like TouchControlsManager) to reset the drag state
   * when they need to take control of the interaction
   */
  resetDrag() {
    this.drag = undefined;

    // Reset cursor
    this.renderer.domElement.style.cursor = "auto";
  }

  /**
   * Handle pointer down event for camera and sun control
   * @param {PointerEvent} event - The pointer event
   */
  onPointerDown(event) {
    // Prevent default behavior to avoid unwanted scrolling or zooming
    event.preventDefault();

    // Store the pointer position
    if (event.touches && event.touches.length > 0) {
      // Touch event
      const rect = this.renderer.domElement.getBoundingClientRect();
      this.previousPointerX = event.touches[0].clientX - rect.left;
      this.previousPointerY = event.touches[0].clientY - rect.top;
    } else {
      // Mouse or pointer event
      this.previousPointerX = event.offsetX;
      this.previousPointerY = event.offsetY;
    }

    // Check if the pointer is over the sun
    if (this.isPointerOverSun(event)) {
      this.drag = "sun";
      this.renderer.domElement.style.cursor = "grabbing";
    } else {
      this.drag = "camera";
      this.renderer.domElement.style.cursor = "grabbing";
    }

    // Capture pointer to ensure we get events even if the pointer moves outside the canvas
    if (event.pointerId !== undefined) {
      this.renderer.domElement.setPointerCapture(event.pointerId);
    }
  }

  /**
   * Handle pointer move event for camera and sun control
   * Updates camera or sun position based on pointer movement
   * @param {PointerEvent} event - The pointer event
   */
  onPointerMove(event) {
    // Prevent default behavior to avoid unwanted scrolling
    event.preventDefault();

    // Update cursor when hovering over the sun (only for non-touch)
    if (
      !this.drag &&
      event.pointerType !== "touch" &&
      this.isPointerOverSun(event)
    ) {
      this.renderer.domElement.style.cursor = "grab";
    } else if (!this.drag && event.pointerType !== "touch") {
      this.renderer.domElement.style.cursor = "auto";
    }

    if (!this.drag) return;

    const kScale = 500;
    let pointerX, pointerY;

    // Get the correct coordinates regardless of event type
    if (event.touches && event.touches.length > 0) {
      // Touch event
      const rect = this.renderer.domElement.getBoundingClientRect();
      pointerX = event.touches[0].clientX - rect.left;
      pointerY = event.touches[0].clientY - rect.top;
    } else {
      // Mouse or pointer event
      pointerX = event.offsetX;
      pointerY = event.offsetY;
    }

    if (this.drag === "sun") {
      // Update sun position
      this.demo.sunZenithAngleRadians -=
        (this.previousPointerY - pointerY) / kScale;
      this.demo.sunZenithAngleRadians = Math.max(
        0,
        Math.min(Math.PI, this.demo.sunZenithAngleRadians)
      );
      this.demo.sunAzimuthAngleRadians +=
        (this.previousPointerX - pointerX) / kScale;

      // Update sun direction in the shader
      const sunDirection = new THREE.Vector3(
        Math.sin(this.demo.sunZenithAngleRadians) *
          Math.cos(this.demo.sunAzimuthAngleRadians),
        Math.sin(this.demo.sunZenithAngleRadians) *
          Math.sin(this.demo.sunAzimuthAngleRadians),
        Math.cos(this.demo.sunZenithAngleRadians)
      );
      this.demo.material.uniforms.sun_direction.value = sunDirection;
    } else if (this.drag === "camera") {
      // Update camera position
      this.demo.viewZenithAngleRadians +=
        (this.previousPointerY - pointerY) / kScale;
      this.demo.viewZenithAngleRadians = Math.max(
        0,
        Math.min(Math.PI / 2, this.demo.viewZenithAngleRadians)
      );
      this.demo.viewAzimuthAngleRadians +=
        (this.previousPointerX - pointerX) / kScale;

      // Update camera position based on spherical coordinates
      this.demo.updateCameraPosition();
    }

    this.previousPointerX = pointerX;
    this.previousPointerY = pointerY;
  }

  /**
   * Handle pointer up event to end dragging operations
   * @param {PointerEvent} event - The pointer event
   */
  onPointerUp(event) {
    // Prevent default behavior
    event.preventDefault();

    this.drag = undefined;

    // Reset cursor (only for non-touch)
    if (event.pointerType !== "touch") {
      this.renderer.domElement.style.cursor = "auto";
    }

    // Release pointer capture
    if (event.pointerId !== undefined) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
  }

  /**
   * Handle wheel event for camera zoom
   * @param {WheelEvent} event - The wheel event
   */
  onWheel(event) {
    // Zoom in/out
    this.demo.viewDistanceMeters *= event.deltaY > 0 ? 1.05 : 1 / 1.05;
    this.demo.updateCameraPosition();

    // Prevent default scroll behavior
    event.preventDefault();
  }

  /**
   * Check if the pointer is over the sun
   * @param {PointerEvent} event - The pointer event
   * @returns {boolean} - True if the pointer is over the sun
   */
  isPointerOverSun(event) {
    // Get canvas dimensions
    const canvas = this.renderer.domElement;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;

    // Get the correct coordinates regardless of event type
    let clientX, clientY;

    // Handle both touch and mouse events
    if (event.touches && event.touches.length > 0) {
      // Touch event
      const rect = canvas.getBoundingClientRect();
      clientX = event.touches[0].clientX - rect.left;
      clientY = event.touches[0].clientY - rect.top;
    } else {
      // Mouse or pointer event
      clientX = event.offsetX;
      clientY = event.offsetY;
    }

    // Normalize coordinates to [-1, 1]
    const normalizedX = (clientX / width) * 2 - 1;
    const normalizedY = -(clientY / height) * 2 + 1;

    // Create a ray from the camera through the pointer position
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(
      new THREE.Vector2(normalizedX, normalizedY),
      this.demo.camera
    );

    // Get the sun direction in world space
    const sunDirection =
      this.demo.material.uniforms.sun_direction.value.clone();

    // Calculate the angle between the ray and the sun direction
    const rayDirection = raycaster.ray.direction;
    const angleBetween = rayDirection.angleTo(sunDirection);

    // Get the sun angular radius (in radians)
    const sunAngularRadius = Math.atan(
      this.demo.material.uniforms.sun_size.value.x
    );

    // Add a larger tolerance for touch devices for easier selection
    const selectionTolerance = event.pointerType === "touch" ? 2.5 : 1.5;

    // Check if the angle is less than the sun's angular radius (plus tolerance)
    return angleBetween < sunAngularRadius * selectionTolerance;
  }
}
