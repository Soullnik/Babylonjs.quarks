import {IAnimationData, IPrefab} from 'quarks.core';
import {TransformNode} from '@babylonjs/core/Meshes/transformNode';
import {Scene} from '@babylonjs/core/scene';
import {ParticleEmitter} from './ParticleEmitter';
import {BatchedRenderer} from './BatchedRenderer';

interface AnimationData extends IAnimationData {
    type: 'ps';
    target: ParticleEmitter;
    loop: boolean;
}

interface AnimationJSON {
    startTime: number;
    duration: number;
    type: 'ps';
    targetUUID: string;
    loop: boolean;
}

export class QuarksPrefab extends TransformNode implements IPrefab {
    type = 'QuarksPrefab';
    animationData: Array<AnimationData> = [];
    isPlaying = false;
    currentTime = -0.00001;
    timeScale = 1;
    duration = 0;

    private _lastUpdateTimeMs = Date.now();
    private _batchedRenderer?: BatchedRenderer;
    private _tempAnimationJSON: Array<AnimationJSON> = [];

    constructor(name = 'QuarksPrefab', scene?: Scene) {
        super(name, scene);
    }

    registerBatchedRenderer(renderer: BatchedRenderer): void {
        this._batchedRenderer = renderer;
    }

    addParticleSystemAnimation(
        emitter: ParticleEmitter,
        startTime = 0,
        duration = 0,
        loop = false
    ): AnimationData {
        const animationDuration = duration > 0 ? duration : emitter.system.duration;
        const data: AnimationData = {
            startTime,
            duration: animationDuration,
            type: 'ps',
            loop,
            target: emitter,
        };
        this.animationData.push(data);
        this.pause();
        this.updateDuration();
        return data;
    }

    removeAnimation(index: number): void {
        this.animationData.splice(index, 1);
        this.updateDuration();
    }

    play(): void {
        if (this.isPlaying) return;
        this.isPlaying = true;
        this._lastUpdateTimeMs = Date.now();
    }

    pause(): void {
        if (!this.isPlaying) return;
        this.isPlaying = false;
        this.animationData.forEach((animation) => {
            animation.target.system.pause();
        });
    }

    stop(): void {
        this.pause();
        this.currentTime = -0.00001;
        this.animationData.forEach((animation) => {
            animation.target.system.stop();
        });
    }

    update(forceDelta?: number): void {
        if (!this.isPlaying) return;
        const now = Date.now();
        const delta = forceDelta ?? Math.max((now - this._lastUpdateTimeMs) / 1000, 0);
        this._lastUpdateTimeMs = now;
        const previousTime = this.currentTime;
        this.currentTime += delta * this.timeScale;

        if (this.currentTime > this.duration) {
            this.stop();
            return;
        }

        this.animationData.forEach((animation) => {
            const startTime = animation.startTime;
            const endTime = animation.startTime + animation.duration;
            const isActive = this.currentTime >= startTime && this.currentTime <= endTime;
            const wasActive = previousTime >= startTime && previousTime <= endTime;
            if (isActive && !wasActive) {
                animation.target.system.restart();
                if (this._batchedRenderer) {
                    this._batchedRenderer.addSystem(animation.target.system);
                }
                return;
            }

            if (!isActive && wasActive) {
                if (animation.loop) {
                    animation.target.system.restart();
                    return;
                }
                animation.target.system.endEmit();
            }
        });
    }

    setTime(time: number): void {
        const previousTime = this.currentTime;
        this.currentTime = time;
        this.animationData.forEach((animation) => {
            const startTime = animation.startTime;
            const endTime = animation.startTime + animation.duration;
            const isActive = this.currentTime >= startTime && this.currentTime < endTime;
            const wasActive = previousTime >= startTime && previousTime < endTime;
            if (isActive && !wasActive) {
                animation.target.system.restart();
                return;
            }
            if (!isActive && wasActive) {
                animation.target.system.endEmit();
            }
        });
    }

    getDuration(): number {
        return this.duration;
    }

    resolveReferences(root: TransformNode): void {
        const nodesMap: {[uuid: string]: TransformNode} = {};
        const traverse = (node: TransformNode) => {
            if ((node as any)._quarksUUID) {
                nodesMap[(node as any)._quarksUUID] = node;
            }
            nodesMap[node.uniqueId.toString()] = node;
            const children = node.getChildren();
            for (const child of children) {
                if (child instanceof TransformNode) {
                    traverse(child);
                }
            }
        };
        traverse(root);

        this._tempAnimationJSON.forEach((animationJSON) => {
            const target = nodesMap[animationJSON.targetUUID];
            if (target instanceof ParticleEmitter) {
                this.addParticleSystemAnimation(
                    target,
                    animationJSON.startTime,
                    animationJSON.duration,
                    animationJSON.loop
                );
            }
        });
        this.updateDuration();
        this._tempAnimationJSON = [];
    }

    toJSON(): any {
        return {
            type: this.type,
            name: this.name,
            animationData: this.animationData.map((animation) => ({
                startTime: animation.startTime,
                duration: animation.duration,
                type: animation.type,
                targetUUID: (animation.target as any)._quarksUUID ?? animation.target.uniqueId.toString(),
                loop: animation.loop,
            })),
        };
    }

    static fromJSON(json: any, scene?: Scene): QuarksPrefab {
        const prefab = new QuarksPrefab(json.name || 'QuarksPrefab', scene);
        if (Array.isArray(json.animationData)) {
            prefab._tempAnimationJSON = json.animationData.filter((item: any) => item?.type === 'ps');
        }
        return prefab;
    }

    private updateDuration(): void {
        let maxDuration = 0;
        this.animationData.forEach((animation) => {
            const endTime = animation.startTime + animation.duration;
            if (endTime > maxDuration) {
                maxDuration = endTime;
            }
        });
        this.duration = maxDuration;
    }
}
