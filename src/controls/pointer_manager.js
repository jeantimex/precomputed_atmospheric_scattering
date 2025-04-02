import * as THREE from "three";
import { Atmosphere } from "../atmosphere";

/**
 * PointerManager class for handling pointer events
 * Provides methods for handling mouse and pointer interactions and updating the atmosphere accordingly
 * Handles camera movement and sun position control
 */
export class PointerManager {
  /**
   * Creates a new pointer controls manager
   * @param {Atmosphere} atmosphere - The atmosphere instance to control
   */
  constructor(atmosphere) {
    this.atmosphere = atmosphere;
    this.renderer = atmosphere.renderer;

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

    // Check if the pointer is over the sun (safely)
    try {
      if (this.atmosphere.material && this.atmosphere.material.uniforms && this.isPointerOverSun(event)) {
        this.drag = "sun";
        this.renderer.domElement.style.cursor = "grabbing";
      } else {
        this.drag = "camera";
        this.renderer.domElement.style.cursor = "grabbing";
      }
    } catch (error) {
      // If there's an error checking for sun hover, default to camera drag
      this.drag = "camera";
      this.renderer.domElement.style.cursor = "grabbing";
      console.warn("Error in pointer down:", error);
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

    // Only check for sun hover if material is initialized
    if (!this.drag && event.pointerType !== "touch") {
      try {
        if (this.isPointerOverSun(event)) {
          this.renderer.domElement.style.cursor = "grab";
        } else {
          this.renderer.domElement.style.cursor = "auto";
        }
      } catch (error) {
        // If there's an error checking for sun hover, just use default cursor
        this.renderer.domElement.style.cursor = "auto";
        console.warn("Error checking sun hover:", error);
      }
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
      this.atmosphere.sunZenithAngleRadians -=
        (this.previousPointerY - pointerY) / kScale;
      this.atmosphere.sunZenithAngleRadians = Math.max(
        0,
        Math.min(Math.PI, this.atmosphere.sunZenithAngleRadians)
      );
      this.atmosphere.sunAzimuthAngleRadians +=
        (this.previousPointerX - pointerX) / kScale;

      // Update sun direction in the shader
      const sunDirection = new THREE.Vector3(
        Math.sin(this.atmosphere.sunZenithAngleRadians) *
          Math.cos(this.atmosphere.sunAzimuthAngleRadians),
        Math.sin(this.atmosphere.sunZenithAngleRadians) *
          Math.sin(this.atmosphere.sunAzimuthAngleRadians),
        Math.cos(this.atmosphere.sunZenithAngleRadians)
      );
      this.atmosphere.material.uniforms.sun_direction.value = sunDirection;
    } else if (this.drag === "camera") {
      // Update camera position
      this.atmosphere.viewZenithAngleRadians +=
        (this.previousPointerY - pointerY) / kScale;
      this.atmosphere.viewZenithAngleRadians = Math.max(
        0,
        Math.min(Math.PI / 2, this.atmosphere.viewZenithAngleRadians)
      );
      this.atmosphere.viewAzimuthAngleRadians +=
        (this.previousPointerX - pointerX) / kScale;

      // Update camera position based on spherical coordinates
      this.atmosphere.updateCameraPosition();
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
    this.atmosphere.viewDistanceMeters *= event.deltaY > 0 ? 1.05 : 1 / 1.05;
    this.atmosphere.updateCameraPosition();

    // Prevent default scroll behavior
    event.preventDefault();
  }

  /**
   * Check if the pointer is over the sun
   * @param {PointerEvent} event - The pointer event
   * @returns {boolean} - True if the pointer is over the sun
   */
  isPointerOverSun(event) {
    // If material is not initialized yet, return false
    if (!this.atmosphere.material || !this.atmosphere.material.uniforms) {
      return false;
    }
    
    // Create a raycaster from the camera through the pointer position
    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2(
      (event.clientX / window.innerWidth) * 2 - 1,
      -(event.clientY / window.innerHeight) * 2 + 1
    );

    raycaster.setFromCamera(
      pointer,
      this.atmosphere.camera
    );

    // Get the sun direction in world space
    const sunDirection =
      this.atmosphere.material.uniforms.sun_direction.value.clone();

    // Calculate the angle between the ray and the sun direction
    const rayDirection = raycaster.ray.direction;
    const angleBetween = rayDirection.angleTo(sunDirection);

    // Get the sun angular radius (in radians)
    const sunAngularRadius = Math.atan(
      this.atmosphere.material.uniforms.sun_size.value.x
    );

    // Return true if the angle between the ray and the sun direction
    // is less than the sun's angular radius (meaning the pointer is over the sun)
    return angleBetween < sunAngularRadius * 3; // Multiply by 3 for easier selection
  }
}
