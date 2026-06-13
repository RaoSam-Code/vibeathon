import React, { Suspense, Component, type ReactNode, useEffect } from "react";
import { Canvas } from "@react-three/fiber";
import { useGLTF, Environment, ContactShadows, PerspectiveCamera } from "@react-three/drei";
import { Loader2, AlertCircle } from "lucide-react";

// Error Boundary for R3F Canvas / useGLTF Suspense errors
class ErrorBoundary extends Component<
  { children: ReactNode; fallback: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: any, errorInfo: any) {
    console.error("ErrorBoundary caught 3D loader error:", error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }
    return this.props.children;
  }
}

// Sub-component to load the GLTF model
function ModelLoader({ modelPath }: { modelPath: string }) {
  const { scene } = useGLTF(modelPath);

  // Clean up resource on unmount
  useEffect(() => {
    return () => {
      scene.traverse((object: any) => {
        if (object.isMesh) {
          object.geometry.dispose();
          if (Array.isArray(object.material)) {
            object.material.forEach((mat) => mat.dispose());
          } else {
            object.material.dispose();
          }
        }
      });
    };
  }, [scene]);

  // Position the avatar chest-up in the viewport matching the camera height
  return <primitive object={scene} position={[0, -2.3, 0]} scale={2.0} />;
}

// 2D Canvas Spinner Fallback
function CanvasLoader() {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/40 backdrop-blur-sm z-10 rounded-3xl">
      <Loader2 className="w-10 h-10 text-blue-500 animate-spin mb-3" />
      <p className="text-xs text-slate-300 font-bold uppercase tracking-wider animate-pulse">Initializing 3D Stream...</p>
    </div>
  );
}

// Simple Error Boundary Fallback for missing/corrupted GLB files
function ModelFallback({ errorMsg }: { errorMsg: string }) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center bg-slate-900/90 text-center p-6 z-20 rounded-3xl border border-red-500/20">
      <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-red-500/10 text-red-500 mb-4 shadow-[0_0_15px_rgba(239,68,68,0.2)]">
        <AlertCircle className="w-6 h-6" />
      </div>
      <h4 className="font-bold text-sm text-slate-200 mb-1">3D Stream Unavailable</h4>
      <p className="text-xs text-slate-500 max-w-[200px] leading-relaxed">
        {errorMsg || "The 3D model could not be fetched or initialized."}
      </p>
    </div>
  );
}

interface InterviewAvatarProps {
  modelPath: string;
}

export default function InterviewAvatar({ modelPath }: InterviewAvatarProps) {
  // Only /models/the-executive.glb is physically present in the public/models directory.
  // We avoid rendering Canvas for other non-existent paths to prevent 404 console errors and WebGL context loss.
  const isModelAvailable = modelPath === "/models/the-executive.glb";

  if (!isModelAvailable) {
    return <ModelFallback errorMsg="3D stream unavailable for this persona (2D Fallback active)." />;
  }

  return (
    <div className="relative w-full h-full min-h-[300px] rounded-3xl overflow-hidden bg-[#0e1626]">
      <ErrorBoundary key={modelPath} fallback={<ModelFallback errorMsg="GLTF model failed to parse or load." />}>
        <Suspense fallback={<CanvasLoader />}>
          <Canvas
            shadows
            className="w-full h-full"
            gl={{ antialias: true, preserveDrawingBuffer: true }}
          >
            {/* Portrait webcam-like perspective camera: chest-up focus */}
            <PerspectiveCamera makeDefault position={[0, 1.5, 3]} fov={45} />
            
            {/* Professional Studio Lights */}
            <ambientLight intensity={0.6} />
            <directionalLight
              position={[2, 6, 4]}
              intensity={1.2}
              castShadow
              shadow-mapSize-width={1024}
              shadow-mapSize-height={1024}
              shadow-bias={-0.0001}
            />
            <pointLight position={[-3, 3, -2]} intensity={0.6} />
            <directionalLight position={[0, -2, -2]} intensity={0.3} />

            <ModelLoader modelPath={modelPath} />

            {/* Clean City environment presets for executive attire reflection */}
            <Environment preset="city" />
            
            {/* Subtle realistic contact shadows */}
            <ContactShadows
              position={[0, -2.3, 0]}
              opacity={0.65}
              scale={8}
              blur={2.5}
              far={4}
            />
          </Canvas>
        </Suspense>
      </ErrorBoundary>
    </div>
  );
}
