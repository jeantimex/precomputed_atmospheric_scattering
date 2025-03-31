// three.js port of https://ebruneton.github.io/precomputed_atmospheric_scattering
// See shaders.js for license
import * as THREE from 'three'
import { vertexShader } from './shaders/vertex'
import { fragmentShader } from './shaders/fragment'

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
const kSunAngularRadius = 0.00935 / 2;  // Angular radius of the sun in radians
const kLengthUnitInMeters = 1000;       // Conversion factor: 1 unit = 1000 meters

/**
 * Main Demo class for atmospheric scattering visualization
 * Implements a Three.js based renderer for the precomputed atmospheric scattering model
 */
export class Demo {
  /**
   * Creates a new atmospheric scattering demo
   * @param {HTMLElement} container - The DOM element to render into
   */
  constructor(container) {
    this.container = container;
    this.renderer = null;
    this.camera = null;
    this.scene = null;
    this.material = null;

    // Initial sun position (in spherical coordinates)
    this.sunZenithAngleRadians = 1.3;   // Angle from zenith (0 = directly overhead)
    this.sunAzimuthAngleRadians = 2.9;  // Horizontal angle (counterclockwise from x-axis)

    this.init();
  }

  /**
   * Initialize the demo by setting up renderer, camera, scene and starting animation
   */
  async init() {
    this.setupRenderer();
    this.setupCamera();
    this.setupControls();
    await this.loadTextures();
    this.setupScene();
    this.setupEventListeners();
    
    // Set default view (same as key 1)
    this.setView(9000, 1.47, 0, 1.3, 3, 10);
    
    this.startAnimationLoop();
  }

  /**
   * Set up the WebGL renderer with appropriate settings
   */
  setupRenderer() {
    // Find the existing canvas element
    const canvas = document.getElementById('glcanvas');
    
    this.renderer = new THREE.WebGLRenderer({
      canvas: canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // No need to append the canvas as it's already in the DOM
  }

  /**
   * Set up the camera with appropriate position and orientation
   */
  setupCamera() {
    this.camera = new THREE.PerspectiveCamera(
      50,                                   // Field of view in degrees
      window.innerWidth / window.innerHeight, // Aspect ratio
      0.1,                                  // Near clipping plane
      1000                                  // Far clipping plane
    );
    // Position camera to match the original demo's orientation
    this.camera.position.set(0, -9, 0.9);
    this.camera.up.set(0, 0, 1); // Set camera's up vector to match scene
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Set up custom camera controls for navigation
   * Implements pointer-based camera movement for both mouse and touch devices
   */
  setupControls() {
    // Disable the default OrbitControls
    // this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    
    // Add event listeners for our custom camera control using pointer events
    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown.bind(this));
    this.renderer.domElement.addEventListener('pointermove', this.onPointerMove.bind(this));
    this.renderer.domElement.addEventListener('pointerup', this.onPointerUp.bind(this));
    this.renderer.domElement.addEventListener('pointercancel', this.onPointerUp.bind(this));
    this.renderer.domElement.addEventListener('wheel', this.onWheel.bind(this));
    
    // For pinch-to-zoom on touch devices
    this.renderer.domElement.addEventListener('touchstart', this.onTouchStart.bind(this), { passive: false });
    this.renderer.domElement.addEventListener('touchmove', this.onTouchMove.bind(this), { passive: false });
    this.renderer.domElement.addEventListener('touchend', this.onTouchEnd.bind(this), { passive: false });
    
    // Store initial values for camera control
    this.drag = undefined;
    this.previousPointerX = 0;
    this.previousPointerY = 0;
    
    // For pinch-to-zoom
    this.previousTouchDistance = 0;
    this.activeTouches = [];
    
    // Initial camera angles (similar to the original implementation)
    this.viewZenithAngleRadians = 1.47;    // Angle from zenith
    this.viewAzimuthAngleRadians = 0;      // Horizontal angle
    this.viewDistanceMeters = 9000;        // Distance from origin
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
    const normalizedBaseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    
    const assetUrls = [
      `${normalizedBaseUrl}assets/transmittance.dat`,   // Transmittance lookup table
      `${normalizedBaseUrl}assets/scattering.dat`,      // Scattering lookup table
      `${normalizedBaseUrl}assets/irradiance.dat`       // Irradiance lookup table
    ];

    try {
      // Load all texture data in parallel
      const [transmittanceData, scatteringData, irradianceData] = await Promise.all(
        assetUrls.map((url) =>
          fetch(url)
            .then((res) => {
              if (!res.ok) {
                console.error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
                throw new Error(`Failed to load ${url}: ${res.status} ${res.statusText}`);
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
      this.transmittanceTexture.magFilter = this.transmittanceTexture.minFilter =
        THREE.LinearFilter;
      this.transmittanceTexture.internalFormat = this.renderer.extensions.has(
        'OES_texture_float_linear'
      )
        ? 'RGBA32F'
        : 'RGBA16F';
      this.transmittanceTexture.type = THREE.FloatType;
      this.transmittanceTexture.needsUpdate = true; // three.js unsets this for data textures since r136

      // Create scattering texture (3D)
      this.scatteringTexture = new THREE.Data3DTexture(
        scatteringData,
        SCATTERING_TEXTURE_WIDTH,
        SCATTERING_TEXTURE_HEIGHT,
        SCATTERING_TEXTURE_DEPTH
      );
      this.scatteringTexture.magFilter = this.scatteringTexture.minFilter = THREE.LinearFilter;
      this.scatteringTexture.internalFormat = 'RGBA16F';
      this.scatteringTexture.type = THREE.FloatType;
      this.scatteringTexture.needsUpdate = true;

      // Create irradiance texture (2D)
      this.irradianceTexture = new THREE.DataTexture(
        irradianceData,
        IRRADIANCE_TEXTURE_WIDTH,
        IRRADIANCE_TEXTURE_HEIGHT
      );
      this.irradianceTexture.magFilter = this.irradianceTexture.minFilter = THREE.LinearFilter;
      this.irradianceTexture.internalFormat = 'RGBA16F';
      this.irradianceTexture.type = THREE.FloatType;
      this.irradianceTexture.needsUpdate = true;
    } catch (error) {
      console.error('Error loading textures:', error);
      alert('Failed to load textures. See console for details.');
    }
  }

  /**
   * Set up the scene with sky mesh and shader material
   * Creates a full-screen quad with the atmospheric scattering shader
   */
  setupScene() {
    // Create a proper full-screen quad for the sky using PlaneGeometry
    const geometry = new THREE.PlaneGeometry(2, 2);

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
          value: new THREE.Vector3(0, 0, -6360000 / kLengthUnitInMeters)
        },
        
        // Sun parameters
        sun_direction: {
          value: new THREE.Vector3(
            Math.sin(this.sunZenithAngleRadians) * Math.cos(this.sunAzimuthAngleRadians),
            Math.sin(this.sunZenithAngleRadians) * Math.sin(this.sunAzimuthAngleRadians),
            Math.cos(this.sunZenithAngleRadians)
          )
        },
        sun_size: {
          value: new THREE.Vector2(
            Math.tan(kSunAngularRadius),
            Math.cos(kSunAngularRadius)
          )
        }
      },
      vertexShader,
      fragmentShader
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
    
    // Add visual helpers for debugging
    const gridHelper = new THREE.GridHelper(100, 10);
    // Rotate grid to match the up vector
    gridHelper.rotation.x = Math.PI / 2;
    this.scene.add(gridHelper);
    
    // Add axes helper
    const axesHelper = new THREE.AxesHelper(5);
    this.scene.add(axesHelper);
  }

  /**
   * Set up event listeners for window resize and keyboard controls
   */
  setupEventListeners() {
    window.addEventListener('resize', this.onWindowResize.bind(this));
    // Add keyboard event listener for preset views
    window.addEventListener('keypress', this.onKeyPress.bind(this));
    // No need to add pointer events here as they're now in setupControls
  }

  /**
   * Handle pointer down event for camera and sun control
   * @param {PointerEvent} event - The pointer event
   */
  onPointerDown(event) {
    this.previousPointerX = event.offsetX;
    this.previousPointerY = event.offsetY;
    
    // If ctrl key is pressed or right button is clicked, enable sun movement
    if (event.ctrlKey || event.button === 2) {
      this.drag = 'sun';
    } else {
      this.drag = 'camera';
    }
    
    // Capture pointer to ensure we get events even if the pointer moves outside the canvas
    this.renderer.domElement.setPointerCapture(event.pointerId);
  }
  
  /**
   * Handle pointer move event for camera and sun control
   * Updates camera or sun position based on pointer movement
   * @param {PointerEvent} event - The pointer event
   */
  onPointerMove(event) {
    if (!this.drag) return;
    
    const kScale = 500;
    const pointerX = event.offsetX;
    const pointerY = event.offsetY;
    
    if (this.drag === 'sun') {
      // Update sun position
      this.sunZenithAngleRadians -= (this.previousPointerY - pointerY) / kScale;
      this.sunZenithAngleRadians = Math.max(0, Math.min(Math.PI, this.sunZenithAngleRadians));
      this.sunAzimuthAngleRadians += (this.previousPointerX - pointerX) / kScale;
      
      // Update sun direction in the shader
      const sunDirection = new THREE.Vector3(
        Math.sin(this.sunZenithAngleRadians) * Math.cos(this.sunAzimuthAngleRadians),
        Math.sin(this.sunZenithAngleRadians) * Math.sin(this.sunAzimuthAngleRadians),
        Math.cos(this.sunZenithAngleRadians)
      );
      this.material.uniforms.sun_direction.value = sunDirection;
    } else if (this.drag === 'camera') {
      // Update camera position
      this.viewZenithAngleRadians += (this.previousPointerY - pointerY) / kScale;
      this.viewZenithAngleRadians = Math.max(0, Math.min(Math.PI / 2, this.viewZenithAngleRadians));
      this.viewAzimuthAngleRadians += (this.previousPointerX - pointerX) / kScale;
      
      // Update camera position based on spherical coordinates
      const distance = this.viewDistanceMeters / kLengthUnitInMeters;
      const x = distance * Math.sin(this.viewZenithAngleRadians) * Math.cos(this.viewAzimuthAngleRadians);
      const y = distance * Math.sin(this.viewZenithAngleRadians) * Math.sin(this.viewAzimuthAngleRadians);
      const z = distance * Math.cos(this.viewZenithAngleRadians);
      
      this.camera.position.set(x, y, z);
      this.camera.lookAt(0, 0, 0);
    }
    
    this.previousPointerX = pointerX;
    this.previousPointerY = pointerY;
  }
  
  /**
   * Handle pointer up event to end dragging operations
   * @param {PointerEvent} event - The pointer event
   */
  onPointerUp(event) {
    this.drag = undefined;
    // Release pointer capture
    this.renderer.domElement.releasePointerCapture(event.pointerId);
  }
  
  /**
   * Handle wheel event for camera zoom
   * @param {WheelEvent} event - The wheel event
   */
  onWheel(event) {
    // Zoom in/out
    this.viewDistanceMeters *= event.deltaY > 0 ? 1.05 : 1 / 1.05;
    this.updateCameraPosition();
    
    // Prevent default scroll behavior
    event.preventDefault();
  }
  
  /**
   * Handle touch start event for multi-touch gestures
   * @param {TouchEvent} event - The touch event
   */
  onTouchStart(event) {
    // Store touch points for pinch-to-zoom
    this.activeTouches = Array.from(event.touches);
    
    if (this.activeTouches.length === 2) {
      // Calculate initial distance between two touch points for pinch-to-zoom
      const touch1 = this.activeTouches[0];
      const touch2 = this.activeTouches[1];
      this.previousTouchDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
    }
    
    // Prevent default to avoid page scrolling
    event.preventDefault();
  }
  
  /**
   * Handle touch move event for multi-touch gestures
   * @param {TouchEvent} event - The touch event
   */
  onTouchMove(event) {
    // Handle pinch-to-zoom with two fingers
    if (event.touches.length === 2) {
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      const currentDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      if (this.previousTouchDistance > 0) {
        // Calculate zoom factor based on the change in distance
        const zoomFactor = currentDistance / this.previousTouchDistance;
        
        // Apply zoom (pinch in = zoom out, pinch out = zoom in)
        this.viewDistanceMeters /= zoomFactor;
        this.updateCameraPosition();
      }
      
      this.previousTouchDistance = currentDistance;
    }
    
    // Prevent default to avoid page scrolling
    event.preventDefault();
  }
  
  /**
   * Handle touch end event
   * @param {TouchEvent} event - The touch event
   */
  onTouchEnd(event) {
    this.activeTouches = Array.from(event.touches);
    this.previousTouchDistance = 0;
    
    // Prevent default behavior
    event.preventDefault();
  }
  
  /**
   * Update camera position based on current view parameters
   * Extracted as a separate method to avoid code duplication
   */
  updateCameraPosition() {
    const distance = this.viewDistanceMeters / kLengthUnitInMeters;
    const x = distance * Math.sin(this.viewZenithAngleRadians) * Math.cos(this.viewAzimuthAngleRadians);
    const y = distance * Math.sin(this.viewZenithAngleRadians) * Math.sin(this.viewAzimuthAngleRadians);
    const z = distance * Math.cos(this.viewZenithAngleRadians);
    
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
  }

  /**
   * Handle window resize event to update renderer and camera
   */
  onWindowResize() {
    const canvas = document.getElementById('glcanvas');
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    canvas.style.width = `${window.innerWidth}px`;
    canvas.style.height = `${window.innerHeight}px`;
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
  }

  /**
   * Start the animation loop for continuous rendering
   */
  startAnimationLoop() {
    this.renderer.setAnimationLoop(this.render.bind(this));
  }

  /**
   * Render the scene
   */
  render() {
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
  setView(viewDistanceMeters, viewZenithAngleRadians, viewAzimuthAngleRadians,
      sunZenithAngleRadians, sunAzimuthAngleRadians, exposure) {
    this.viewDistanceMeters = viewDistanceMeters;
    this.viewZenithAngleRadians = viewZenithAngleRadians;
    this.viewAzimuthAngleRadians = viewAzimuthAngleRadians;
    this.sunZenithAngleRadians = sunZenithAngleRadians;
    this.sunAzimuthAngleRadians = sunAzimuthAngleRadians;
    
    // Update camera position
    const distance = this.viewDistanceMeters / kLengthUnitInMeters;
    const x = distance * Math.sin(this.viewZenithAngleRadians) * Math.cos(this.viewAzimuthAngleRadians);
    const y = distance * Math.sin(this.viewZenithAngleRadians) * Math.sin(this.viewAzimuthAngleRadians);
    const z = distance * Math.cos(this.viewZenithAngleRadians);
    
    this.camera.position.set(x, y, z);
    this.camera.lookAt(0, 0, 0);
    
    // Update sun direction
    const sunDirection = new THREE.Vector3(
      Math.sin(this.sunZenithAngleRadians) * Math.cos(this.sunAzimuthAngleRadians),
      Math.sin(this.sunZenithAngleRadians) * Math.sin(this.sunAzimuthAngleRadians),
      Math.cos(this.sunZenithAngleRadians)
    );
    this.material.uniforms.sun_direction.value = sunDirection;
    
    // Update exposure
    this.material.uniforms.exposure.value = exposure;
  }

  /**
   * Handle keyboard events for preset views and controls
   * @param {KeyboardEvent} event - The keyboard event
   */
  onKeyPress(event) {
    const key = event.key;
    if (key == 'h') {
      // Toggle help display if implemented
      const helpElement = document.getElementById('help');
      if (helpElement) {
        const hidden = helpElement.style.display == 'none';
        helpElement.style.display = hidden ? 'block' : 'none';
      }
    } else if (key == '+') {
      // Increase exposure
      this.material.uniforms.exposure.value *= 1.1;
    } else if (key == '-') {
      // Decrease exposure
      this.material.uniforms.exposure.value /= 1.1;
    } else if (key == '1') {
      // Preset view 1: Daytime
      this.setView(9000, 1.47, 0, 1.3, 3, 10);
    } else if (key == '2') {
      // Preset view 2: Sunset
      this.setView(9000, 1.47, 0, 1.564, -3, 10);
    } else if (key == '3') {
      // Preset view 3: Sunset with mountains
      this.setView(7000, 1.57, 0, 1.54, -2.96, 10);
    } else if (key == '4') {
      // Preset view 4: Sunset with mountains (different angle)
      this.setView(7000, 1.57, 0, 1.328, -3.044, 10);
    } else if (key == '5') {
      // Preset view 5: Morning
      this.setView(9000, 1.39, 0, 1.2, 0.7, 10);
    } else if (key == '6') {
      // Preset view 6: Night
      this.setView(9000, 1.5, 0, 1.628, 1.05, 200);
    } else if (key == '7') {
      // Preset view 7: Night with mountains
      this.setView(7000, 1.43, 0, 1.57, 1.34, 40);
    } else if (key == '8') {
      // Preset view 8: High altitude
      this.setView(2.7e6, 0.81, 0, 1.57, 2, 10);
    } else if (key == '9') {
      // Preset view 9: Space view
      this.setView(1.2e7, 0.0, 0, 0.93, -2, 10);
    }
  }
}
