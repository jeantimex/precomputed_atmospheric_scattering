/**
 * KeyboardManager class for handling keyboard events
 * Provides methods for handling keyboard shortcuts and updating the demo accordingly
 */
export class KeyboardManager {
  /**
   * Creates a new keyboard controls manager
   * @param {Atmosphere} atmosphere - The atmosphere instance to control
   */
  constructor(atmosphere) {
    this.atmosphere = atmosphere;

    // Add keyboard event listener
    window.addEventListener("keypress", this.onKeyPress.bind(this));
  }

  /**
   * Handle keyboard events for preset views and controls
   * @param {KeyboardEvent} event - The keyboard event
   */
  onKeyPress(event) {
    const key = event.key;
    if (key == "h") {
      // Toggle help display if implemented
      const helpElement = document.getElementById("help");
      if (helpElement) {
        const hidden = helpElement.style.display == "none";
        helpElement.style.display = hidden ? "block" : "none";
      }
    } else if (key == "v") {
      // Toggle sphere visibility
      this.atmosphere.toggleSphereVisibility();
    } else if (key == "+") {
      // Increase exposure
      this.atmosphere.material.uniforms.exposure.value *= 1.1;
    } else if (key == "-") {
      // Decrease exposure
      this.atmosphere.material.uniforms.exposure.value /= 1.1;
    } else if (key == "1") {
      // Preset view 1: Daytime
      this.atmosphere.setView(9000, 1.47, 0, 1.3, 3, 10);
    } else if (key == "2") {
      // Preset view 2: Sunset
      this.atmosphere.setView(9000, 1.47, 0, 1.564, -3, 10);
    } else if (key == "3") {
      // Preset view 3: Sunset with mountains
      this.atmosphere.setView(7000, 1.57, 0, 1.54, -2.96, 10);
    } else if (key == "4") {
      // Preset view 4: Sunset with mountains (different angle)
      this.atmosphere.setView(7000, 1.57, 0, 1.328, -3.044, 10);
    } else if (key == "5") {
      // Preset view 5: Morning
      this.atmosphere.setView(9000, 1.39, 0, 1.2, 0.7, 10);
    } else if (key == "6") {
      // Preset view 6: Night
      this.atmosphere.setView(9000, 1.5, 0, 1.628, 1.05, 200);
    } else if (key == "7") {
      // Preset view 7: Night with mountains
      this.atmosphere.setView(7000, 1.43, 0, 1.57, 1.34, 40);
    } else if (key == "8") {
      // Preset view 8: High altitude
      this.atmosphere.setView(2.7e6, 0.81, 0, 1.57, 2, 10);
    } else if (key == "9") {
      // Preset view 9: Space view
      this.atmosphere.setView(1.2e7, 0.0, 0, 0.93, -2, 10);
    }
  }
}
