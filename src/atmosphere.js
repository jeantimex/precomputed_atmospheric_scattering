// three.js port of https://ebruneton.github.io/precomputed_atmospheric_scattering
// See shaders.js for license
import * as THREE from "three";
import { vertexShader } from "./shaders/vertex";
import { fragmentShader } from "./shaders/fragment";
import { KeyboardManager } from "./controls/keyboard_manager";
import { TouchManager } from "./controls/touch_manager";
import { PointerManager } from "./controls/pointer_manager";

/**
 * Constants for atmospheric scattering textures
 * These define the dimensions of the precomputed lookup tables used for atmospheric rendering
 */
const TRANSMITTANCE_TEXTURE_WIDTH = 256;
const TRANSMITTANCE_TEXTURE_HEIGHT = 64;
const SCATTERING_TEXTURE_WIDTH = 256;
const SCATTERING_TEXTURE_HEIGHT = 128;
const SCATTERING_TEXTURE_DEPTH = 32;
const IRRADIANCE_TEXTURE_WIDTH = 64;
const IRRADIANCE_TEXTURE_HEIGHT = 16;
const kSunAngularRadius = 0.00935 / 2; // Angular radius of the sun in radians
const kLengthUnitInMeters = 1000; // Conversion factor: 1 unit = 1000 meters

/**
 * Main Atmosphere class for atmospheric scattering visualization
 * Implements a Three.js based renderer for the precomputed atmospheric scattering model
 */
export class Atmosphere {
  /**
   * Creates a new atmospheric scattering atmosphere
   * @param {HTMLElement} container - The DOM element to render into
   */
  constructor(container) {
    this.container = container;
    this.renderer = null;
    this.camera = null;
    this.scene = null;
    this.material = null;

    // Initial sun position (in spherical coordinates)
    this.sunZenithAngleRadians = 1.3; // Angle from zenith (0 = directly overhead)
    this.sunAzimuthAngleRadians = 2.9; // Horizontal angle (counterclockwise from x-axis)

    // Initial camera angles (similar to the original implementation)
    this.viewZenithAngleRadians = 1.47; // Angle from zenith
    this.viewAzimuthAngleRadians = 0; // Horizontal angle
    this.viewDistanceMeters = 9000; // Distance from origin

    // Sphere visibility control
    this.sphereVisible = true;

    this.setupRenderer();
    this.setupCamera();
    this.setupEventListeners();
    this.setupScene();
  }

  /**
   * Set up the WebGL renderer with appropriate settings
   */
  setupRenderer() {
    // Find the existing canvas element
    const canvas = document.getElementById("glcanvas");

    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: "high-performance",
    });

    // Set pixel ratio with a cap to avoid performance issues on high-DPI devices
    const maxPixelRatio = 2.0; // Cap pixel ratio for performance
    const devicePixelRatio = Math.min(window.devicePixelRatio, maxPixelRatio);
    this.renderer.setPixelRatio(devicePixelRatio);

    // Set initial size
    this.updateRendererSize();
    // No need to append the canvas as it's already in the DOM
  }

  /**
   * Update renderer size based on current viewport dimensions
   * Extracted as a separate method to avoid code duplication
   */
  updateRendererSize() {
    // Get the current viewport dimensions
    const width = window.innerWidth;
    const height = window.innerHeight;

    // Update renderer size
    this.renderer.setSize(width, height, false); // false = don't update style

    // Update canvas style directly for better mobile handling
    const canvas = this.renderer.domElement;
    canvas.style.width = "100%";
    canvas.style.height = "100%";

    // Update camera aspect ratio
    if (this.camera) {
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
    }
  }

  /**
   * Set up the camera with appropriate position and orientation
   */
  setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      50, // Field of view in degrees
      window.innerWidth / window.innerHeight, // Aspect ratio
      0.1, // Near clipping plane
      1000 // Far clipping plane
    );
    // Position camera to match the original demo's orientation
    this.camera.position.set(0, -9, 0.9);
    this.camera.up.set(0, 0, 1); // Set camera's up vector to match scene
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Load precomputed atmospheric scattering textures
   * These textures contain the precomputed light transport data for the atmosphere
   */
  async loadTextures() {
    // Get the base URL that works in both development and production
    // For GitHub Pages, we need to ensure we're using the correct path
    const baseUrl = import.meta.env.BASE_URL;

    // Ensure the base URL ends with a slash
    const normalizedBaseUrl = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;

    const assetUrls = [
      `${normalizedBaseUrl}assets/transmittance.dat`, // Transmittance lookup table
      `${normalizedBaseUrl}assets/scattering.dat`, // Scattering lookup table
      `${normalizedBaseUrl}assets/irradiance.dat`, // Irradiance lookup table
    ];

    try {
      // Load all texture data in parallel
      const [transmittanceData, scatteringData, irradianceData] =
        await Promise.all(
          assetUrls.map((url) =>
            fetch(url)
              .then((res) => {
                if (!res.ok) {
                  console.error(
                    `Failed to load ${url}: ${res.status} ${res.statusText}`
                  );
                  throw new Error(
                    `Failed to load ${url}: ${res.status} ${res.statusText}`
                  );
                }
                return res.arrayBuffer();
              })
              .then((buffer) => new Float32Array(buffer))
          )
        );

      // Create transmittance texture (2D)
      this.transmittanceTexture = new THREE.DataTexture(
        transmittanceData,
        TRANSMITTANCE_TEXTURE_WIDTH,
        TRANSMITTANCE_TEXTURE_HEIGHT
      );
      this.transmittanceTexture.magFilter =
        this.transmittanceTexture.minFilter = THREE.LinearFilter;
      this.transmittanceTexture.internalFormat = this.renderer.extensions.has(
        "OES_texture_float_linear"
      )
        ? "RGBA32F"
        : "RGBA16F";
      this.transmittanceTexture.type = THREE.FloatType;
      this.transmittanceTexture.needsUpdate = true; // three.js unsets this for data textures since r136

      // Create scattering texture (3D)
      this.scatteringTexture = new THREE.Data3DTexture(
        scatteringData,
        SCATTERING_TEXTURE_WIDTH,
        SCATTERING_TEXTURE_HEIGHT,
        SCATTERING_TEXTURE_DEPTH
      );
      this.scatteringTexture.magFilter = this.scatteringTexture.minFilter =
        THREE.LinearFilter;
      this.scatteringTexture.internalFormat = "RGBA16F";
      this.scatteringTexture.type = THREE.FloatType;
      this.scatteringTexture.needsUpdate = true;

      // Create irradiance texture (2D)
      this.irradianceTexture = new THREE.DataTexture(
        irradianceData,
        IRRADIANCE_TEXTURE_WIDTH,
        IRRADIANCE_TEXTURE_HEIGHT
      );
      this.irradianceTexture.magFilter = this.irradianceTexture.minFilter =
        THREE.LinearFilter;
      this.irradianceTexture.internalFormat = "RGBA16F";
      this.irradianceTexture.type = THREE.FloatType;
      this.irradianceTexture.needsUpdate = true;
    } catch (error) {
      console.error("Error loading textures:", error);
      alert("Failed to load textures. See console for details.");
    }
  }

  /**
   * Set up the scene with sky mesh and shader material
   * Creates a full-screen quad with the atmospheric scattering shader
   */
  async setupScene() {
    // Create a proper full-screen quad for the sky using PlaneGeometry
    const geometry = new THREE.PlaneGeometry(2, 2);

    await this.loadTextures();

    // Create shader material with all necessary uniforms for atmospheric rendering
    this.material = new THREE.RawShaderMaterial({
      glslVersion: THREE.GLSL3,
      uniforms: {
        // Precomputed lookup textures
        transmittance_texture: { value: this.transmittanceTexture },
        scattering_texture: { value: this.scatteringTexture },
        single_mie_scattering_texture: { value: new THREE.Data3DTexture() }, // unused
        irradiance_texture: { value: this.irradianceTexture },

        // Camera and scene parameters
        camera: { value: this.camera.position },
        white_point: { value: new THREE.Vector3(1, 1, 1) },
        exposure: { value: 10 },
        earth_center: {
          value: new THREE.Vector3(0, 0, -6360000 / kLengthUnitInMeters),
        },

        // Sun parameters
        sun_direction: {
          value: new THREE.Vector3(
            Math.sin(this.sunZenithAngleRadians) *
              Math.cos(this.sunAzimuthAngleRadians),
            Math.sin(this.sunZenithAngleRadians) *
              Math.sin(this.sunAzimuthAngleRadians),
            Math.cos(this.sunZenithAngleRadians)
          ),
        },
        sun_size: {
          value: new THREE.Vector2(
            Math.tan(kSunAngularRadius),
            Math.cos(kSunAngularRadius)
          ),
        },
        
        // Sphere visibility control
        sphere_visible: { value: this.sphereVisible },
      },
      vertexShader,
      fragmentShader,
    });

    this.scene = new THREE.Scene();

    // Create sky mesh with the proper geometry
    const skyMesh = new THREE.Mesh(geometry, this.material);
    skyMesh.frustumCulled = false;
    this.scene.add(skyMesh);

    // Add ambient light
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    // Set up vector for the scene
    this.scene.up = new THREE.Vector3(0, 0, 1);

    // Set default view (same as key 1)
    this.setView(9000, 1.47, 0, 1.3, 3, 10);

    this.startAnimationLoop();
  }

  /**
   * Set up event listeners for window resize and keyboard controls
   */
  setupEventListeners() {
    // Initialize keyboard controls manager
    this.keyboardManager = new KeyboardManager(this);

    // Initialize touch controls manager
    this.touchManager = new TouchManager(this);

    // Initialize pointer controls manager
    this.pointerManager = new PointerManager(this);

    // Use both resize event and ResizeObserver for better responsiveness
    window.addEventListener("resize", this.onWindowResize.bind(this));

    // Use ResizeObserver if available for more reliable size change detection
    if (typeof ResizeObserver !== "undefined") {
      this.resizeObserver = new ResizeObserver(
        this.onContainerResize.bind(this)
      );
      this.resizeObserver.observe(this.container);
    }

    // Add orientation change listener for mobile devices
    window.addEventListener(
      "orientationchange",
      this.onWindowResize.bind(this)
    );
  }

  /**
   * Handle container resize event from ResizeObserver
   */
  onContainerResize() {
    this.updateRendererSize();
  }

  /**
   * Handle window resize event to update renderer and camera
   */
  onWindowResize() {
    // Check if device pixel ratio has changed (e.g., when moving between displays)
    const maxPixelRatio = 2.0;
    const currentPixelRatio = Math.min(window.devicePixelRatio, maxPixelRatio);

    if (this.renderer.getPixelRatio() !== currentPixelRatio) {
      this.renderer.setPixelRatio(currentPixelRatio);
    }

    this.updateRendererSize();
  }

  /**
   * Update camera position based on current view parameters
   * Extracted as a separate method to avoid code duplication
   */
  updateCameraPosition() {
    const distance = this.viewDistanceMeters / kLengthUnitInMeters;
    const x =
      distance *
      Math.sin(this.viewZenithAngleRadians) *
      Math.cos(this.viewAzimuthAngleRadians);
    const y =
      distance *
      Math.sin(this.viewZenithAngleRadians) *
      Math.sin(this.viewAzimuthAngleRadians);
    const z = distance * Math.cos(this.viewZenithAngleRadians);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Start the animation loop for continuous rendering
   */
  startAnimationLoop() {
    // Ensure 'this' is properly bound to the render method
    const boundRender = this.render.bind(this);
    this.renderer.setAnimationLoop(boundRender);
  }

  /**
   * Render the scene
   */
  render() {
    // Update camera position in the shader if material is initialized
    if (this.material && this.material.uniforms) {
      this.material.uniforms.camera.value.copy(this.camera.position);
    }
    
    this.renderer.render(this.scene, this.camera);
  }

  /**
   * Set a specific view with predefined parameters
   * Used for preset views accessible via keyboard shortcuts
   *
   * @param {number} viewDistanceMeters - Camera distance from origin in meters
   * @param {number} viewZenithAngleRadians - Camera zenith angle in radians
   * @param {number} viewAzimuthAngleRadians - Camera azimuth angle in radians
   * @param {number} sunZenithAngleRadians - Sun zenith angle in radians
   * @param {number} sunAzimuthAngleRadians - Sun azimuth angle in radians
   * @param {number} exposure - Exposure value for tone mapping
   */
  setView(
    viewDistanceMeters,
    viewZenithAngleRadians,
    viewAzimuthAngleRadians,
    sunZenithAngleRadians,
    sunAzimuthAngleRadians,
    exposure
  ) {
    this.viewDistanceMeters = viewDistanceMeters;
    this.viewZenithAngleRadians = viewZenithAngleRadians;
    this.viewAzimuthAngleRadians = viewAzimuthAngleRadians;
    this.sunZenithAngleRadians = sunZenithAngleRadians;
    this.sunAzimuthAngleRadians = sunAzimuthAngleRadians;

    // Update camera position
    const distance = this.viewDistanceMeters / kLengthUnitInMeters;
    const x =
      distance *
      Math.sin(this.viewZenithAngleRadians) *
      Math.cos(this.viewAzimuthAngleRadians);
    const y =
      distance *
      Math.sin(this.viewZenithAngleRadians) *
      Math.sin(this.viewAzimuthAngleRadians);
    const z = distance * Math.cos(this.viewZenithAngleRadians);

    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);

    // Update sun direction
    const sunDirection = new THREE.Vector3(
      Math.sin(this.sunZenithAngleRadians) *
        Math.cos(this.sunAzimuthAngleRadians),
      Math.sin(this.sunZenithAngleRadians) *
        Math.sin(this.sunAzimuthAngleRadians),
      Math.cos(this.sunZenithAngleRadians)
    );
    this.material.uniforms.sun_direction.value = sunDirection;

    // Update exposure
    this.material.uniforms.exposure.value = exposure;
  }

  /**
   * Toggle the visibility of the floating sphere
   */
  toggleSphereVisibility() {
    this.sphereVisible = !this.sphereVisible;
    this.material.uniforms.sphere_visible.value = this.sphereVisible;
  }
}
