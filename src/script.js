import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js'
import { GPUComputationRenderer } from 'three/addons/misc/GPUComputationRenderer.js'
import GUI from 'lil-gui'

import particlesVertexShader from './shaders/particles/vertex.glsl'
import particlesFragmentShader from './shaders/particles/fragment.glsl'
import gpgpuParticlesShader from './shaders/gpgpu/particles.glsl'

/**
 * Base
 */
const debugObject = {}
const canvas = document.querySelector('canvas.webgl')
const scene = new THREE.Scene()

/**
 * Loaders
 */
const dracoLoader = new DRACOLoader()
dracoLoader.setDecoderPath('https://www.gstatic.com/draco/v1/decoders/')

const gltfLoader = new GLTFLoader()
gltfLoader.setDRACOLoader(dracoLoader)

/**
 * Sizes
 */
const sizes = {
    width: window.innerWidth,
    height: window.innerHeight,
    pixelRatio: Math.min(window.devicePixelRatio, 2)
}

/**
 * Cam
 */

const camera = new THREE.PerspectiveCamera(35, sizes.width / sizes.height, 0.1, 100)
camera.position.set(0.04838905613164544, 5.482525709600349, 2.000000000000001)

scene.add(camera)
camera.far = 5000
camera.updateProjectionMatrix()

const controls = new OrbitControls(camera, canvas)
controls.enableDamping = false
controls.enabled = false

/**
 * Renderer
 */
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true })
renderer.setSize(sizes.width, sizes.height)
renderer.setPixelRatio(sizes.pixelRatio)

debugObject.clearColor = 'black'
renderer.setClearColor(debugObject.clearColor)

/**
 * Resize
 */

window.addEventListener('resize', () =>
{
    sizes.width = window.innerWidth
    sizes.height = window.innerHeight
    sizes.pixelRatio = Math.min(window.devicePixelRatio, 2)

    if (particles.material)
    {
        particles.material.uniforms.uResolution.value.set(
            sizes.width * sizes.pixelRatio,
            sizes.height * sizes.pixelRatio
        )
    }

    camera.aspect = sizes.width / sizes.height
    camera.updateProjectionMatrix()

    renderer.setSize(sizes.width, sizes.height)
    renderer.setPixelRatio(sizes.pixelRatio)
})

/**
 * LOAD GLB
 */
const gltf = await gltfLoader.loadAsync('/mask.glb')

let mesh = null
gltf.scene.traverse(child =>
{
    if (child.isMesh && !mesh)
    {
        mesh = child
    }
})

if (!mesh)
{
    throw new Error('No mesh found in GLB')
}

/**
 * Base geometry
 */
const baseGeometry = {}
baseGeometry.instance = mesh.geometry.clone().toNonIndexed()

baseGeometry.instance.rotateX(Math.PI * -2.5)
baseGeometry.count = baseGeometry.instance.attributes.position.count

console.log('Vertices:', baseGeometry.count)




/**
 * GPU COMPUTE
 */
const gpgpu = {}
gpgpu.size = Math.ceil(Math.sqrt(baseGeometry.count))
gpgpu.computation = new GPUComputationRenderer(gpgpu.size, gpgpu.size, renderer)

console.log('Texture size:', gpgpu.size * gpgpu.size)

const baseParticlesTexture = gpgpu.computation.createTexture()

// Fill 
for (let i = 0; i < baseGeometry.count; i++)
{
    const i3 = i * 3
    const i4 = i * 4

    baseParticlesTexture.image.data[i4 + 0] = baseGeometry.instance.attributes.position.array[i3 + 0]
    baseParticlesTexture.image.data[i4 + 1] = baseGeometry.instance.attributes.position.array[i3 + 1]
    baseParticlesTexture.image.data[i4 + 2] = baseGeometry.instance.attributes.position.array[i3 + 2]
    baseParticlesTexture.image.data[i4 + 3] = Math.random()
}

// Fill unused px 
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
gpgpu.particlesVariable.material.uniforms.uFlowFieldInfluence = new THREE.Uniform(0.747)
gpgpu.particlesVariable.material.uniforms.uFlowFieldStrength = new THREE.Uniform(1.75)
gpgpu.particlesVariable.material.uniforms.uFlowFieldFrequency = new THREE.Uniform(0.5)

const error = gpgpu.computation.init()
if (error !== null)
{
    console.error(error)
}

/**
 * PARTICLES
 */
const particles = {}
const particlesUvArray = new Float32Array(baseGeometry.count * 2)
const sizesArray = new Float32Array(baseGeometry.count)




// real vertices 
for (let i = 0; i < baseGeometry.count; i++)
{
    const i2 = i * 2

    const x = i % gpgpu.size
    const y = Math.floor(i / gpgpu.size)

    particlesUvArray[i2 + 0] = (x + 0.5) / gpgpu.size
    particlesUvArray[i2 + 1] = (y + 0.5) / gpgpu.size

    sizesArray[i] = Math.random()
}

particles.geometry = new THREE.BufferGeometry()
particles.geometry.setDrawRange(0, baseGeometry.count)
particles.geometry.setAttribute('aParticlesUv', new THREE.BufferAttribute(particlesUvArray, 2))


particles.geometry.setAttribute('aSize', new THREE.BufferAttribute(sizesArray, 1))
particles.material = new THREE.ShaderMaterial({
    vertexShader: particlesVertexShader,
    fragmentShader: particlesFragmentShader,
    uniforms:
    {
        uSize: new THREE.Uniform(0.004),  //0.024 for apple or 0.005 for mask with wide cam
        uResolution: new THREE.Uniform(
            new THREE.Vector2(
                sizes.width * sizes.pixelRatio,
                sizes.height * sizes.pixelRatio
            )
        ),
        uParticlesTexture: new THREE.Uniform()
    }
})

particles.points = new THREE.Points(particles.geometry, particles.material)
scene.add(particles.points)


canvas.style.cursor = 'none'


/**
 * Animate
 */
const clock = new THREE.Clock()
let previousTime = 0

const tick = () =>
{
    const elapsedTime = clock.getElapsedTime()
    const deltaTime = elapsedTime - previousTime
    previousTime = elapsedTime

    controls.update()

    gpgpu.particlesVariable.material.uniforms.uTime.value = elapsedTime
    gpgpu.particlesVariable.material.uniforms.uDeltaTime.value = deltaTime

    gpgpu.computation.compute()

    particles.material.uniforms.uParticlesTexture.value =
        gpgpu.computation.getCurrentRenderTarget(gpgpu.particlesVariable).texture

    renderer.render(scene, camera)
    requestAnimationFrame(tick)
}

tick()