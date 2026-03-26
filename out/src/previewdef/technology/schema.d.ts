import { Node, Token } from "../../hoiformat/hoiparser";
export interface TechnologyFolder {
    name: string;
    x: number;
    y: number;
}
export interface Technology {
    id: string;
    folders: Record<string, TechnologyFolder>;
    leadsToTechs: string[];
    xor: string[];
    startYear: number;
    enableEquipments: boolean;
    subTechnologies: Technology[];
    token: Token | undefined;
}
export interface TechnologyTree {
    startTechnology: string;
    folder: string;
    technologies: Technology[];
}
export declare function getTechnologyTrees(node: Node): TechnologyTree[];
