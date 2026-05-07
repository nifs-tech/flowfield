import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'

import particlesVertexShader from './shaders/particles/vertex.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'

/**
 * BASE
 */
const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()

/**
 * LOADERS
 */
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')

const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

/**
 * SIZE
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.min(window.devicePixelRatio, 2)
}

/**
 * CAMERA
 */
const camera = new THREE.PerspectiveCamera(
    35,
    sizes.width / sizes.height,
    0.1,
    100
)

camera.position.set(0, 0, 7)
camera.far = 5000
camera.updateProjectionMatrix()

scene.add(camera)

/**
 * CONTROLS, disabled
 */
const controls = new OrbitControls(camera, canvas)
controls.enabled = false

/**
 * RENDERER
 */
const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true
})

renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(sizes.pixelRatio)
renderer.setClearColor('black')

/**
 * STATE
 */
let particlesReady = false
let particles = null
let gpgpu = null

const clock = new THREE.Clock()
let previousTime = 0

/**
 * LOAD MODEL + INIT SYSTEM
 */
async function init()
{
    const gltf = await gltfLoader.loadAsync('./mask.glb')

    let mesh = null
    gltf.scene.traverse(child =>
    {
        if (child.isMesh && !mesh)
        {
            mesh = child
        }
    })

    if (!mesh) throw new Error('No mesh found in GLB')

    setupParticles(mesh.geometry)

    particlesReady = true
}

init()

/**
 * PARTICLE SETUP
 */
function setupParticles(geometry)
{
    const baseGeometry = {}
    baseGeometry.instance = geometry.clone().toNonIndexed()

    baseGeometry.instance.rotateX(Math.PI / 20)
    baseGeometry.instance.translate(0, 0.2, 0)

    baseGeometry.count = baseGeometry.instance.attributes.position.count

    /**
     * GPU COMPUTE
     */
    gpgpu = {}
    gpgpu.size = Math.ceil(Math.sqrt(baseGeometry.count))
    gpgpu.computation = new GPUComputationRenderer(
        gpgpu.size,
        gpgpu.size,
        renderer
    )

    const baseParticlesTexture = gpgpu.computation.createTexture()

    for (let i = 0; i < baseGeometry.count; i++)
    {
        const i3 = i * 3
        const i4 = i * 4

        baseParticlesTexture.image.data[i4 + 0] = baseGeometry.instance.attributes.position.array[i3 + 0]
        baseParticlesTexture.image.data[i4 + 1] = baseGeometry.instance.attributes.position.array[i3 + 1]
        baseParticlesTexture.image.data[i4 + 2] = baseGeometry.instance.attributes.position.array[i3 + 2]
        baseParticlesTexture.image.data[i4 + 3] = Math.random()
    }

    for (let i = baseGeometry.count; i < gpgpu.size * gpgpu.size; i++)
    {
        const i4 = i * 4
        baseParticlesTexture.image.data[i4 + 0] = 0
        baseParticlesTexture.image.data[i4 + 1] = 0
        baseParticlesTexture.image.data[i4 + 2] = 0
        baseParticlesTexture.image.data[i4 + 3] = 0
    }

    gpgpu.particlesVariable = gpgpu.computation.addVariable(
        'uParticles',
        gpgpuParticlesShader,
        baseParticlesTexture
    )

    gpgpu.computation.setVariableDependencies(
        gpgpu.particlesVariable,
        [gpgpu.particlesVariable]
    )

    gpgpu.particlesVariable.material.uniforms.uTime = new THREE.Uniform(0)
    gpgpu.particlesVariable.material.uniforms.uDeltaTime = new THREE.Uniform(0)
    gpgpu.particlesVariable.material.uniforms.uBase = new THREE.Uniform(baseParticlesTexture)
    gpgpu.particlesVariable.material.uniforms.uFlowFieldInfluence = new THREE.Uniform(0.7)
    gpgpu.particlesVariable.material.uniforms.uFlowFieldStrength = new THREE.Uniform(2)
    gpgpu.particlesVariable.material.uniforms.uFlowFieldFrequency = new THREE.Uniform(0.5)

    const error = gpgpu.computation.init()
    if (error) console.error(error)

    /**
     * PARTICLES
     */
    const particlesUvArray = new Float32Array(baseGeometry.count * 2)
    const sizesArray = new Float32Array(baseGeometry.count)

    for (let i = 0; i < baseGeometry.count; i++)
    {
        const i2 = i * 2

        const x = i % gpgpu.size
        const y = Math.floor(i / gpgpu.size)

        particlesUvArray[i2 + 0] = (x + 0.5) / gpgpu.size
        particlesUvArray[i2 + 1] = (y + 0.5) / gpgpu.size

        sizesArray[i] = Math.random()
    }

    const geometryParticles = new THREE.BufferGeometry()
    geometryParticles.setDrawRange(0, baseGeometry.count)

    geometryParticles.setAttribute(
        'aParticlesUv',
        new THREE.BufferAttribute(particlesUvArray, 2)
    )

    geometryParticles.setAttribute(
        'aSize',
        new THREE.BufferAttribute(sizesArray, 1)
    )

    const material = new THREE.ShaderMaterial({
        vertexShader: particlesVertexShader,
        fragmentShader: particlesFragmentShader,
        uniforms:
        {
            uSize: new THREE.Uniform(0.004),
            uResolution: new THREE.Uniform(
                new THREE.Vector2(
                    sizes.width * sizes.pixelRatio,
                    sizes.height * sizes.pixelRatio
                )
            ),
            uParticlesTexture: new THREE.Uniform()
        }
    })

    particles = new THREE.Points(geometryParticles, material)
    scene.add(particles)

    canvas.style.cursor = 'none'
}

/**
 * RESIZE
 */
window.addEventListener('resize', () =>
{
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    sizes.pixelRatio = Math.min(window.devicePixelRatio, 2)

    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(sizes.pixelRatio)
})

/**
 * ANIMATE
 */
function tick()
{
    requestAnimationFrame(tick)

    if (particlesReady)
    {
        const elapsedTime = clock.getElapsedTime()
        const deltaTime = elapsedTime - previousTime
        previousTime = elapsedTime

        gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime
        gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime

        gpgpu.computation.compute()

        particles.material.uniforms.uParticlesTexture.value =
            gpgpu.computation.getCurrentRenderTarget(
                gpgpu.particlesVariable
            ).texture
    }

    renderer.render(scene, camera)
}

tick()