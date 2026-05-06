import unoEspada from "../assets/cartas/1-espada.png";
import dosEspada from "../assets/cartas/2-espada.png";
import tresEspada from "../assets/cartas/3-espada.png";
import cuatroEspada from "../assets/cartas/4-espada.png";
import cincoEspada from "../assets/cartas/5-espada.png";
import seisEspada from "../assets/cartas/6-espada.png";
import sieteEspada from "../assets/cartas/7-espada.png";
import diezEspada from "../assets/cartas/10-espada.png";
import onceEspada from "../assets/cartas/11-espada.png";
import doceEspada from "../assets/cartas/12-espada.png";

import unoBasto from "../assets/cartas/1-basto.png";
import dosBasto from "../assets/cartas/2-basto.png";
import tresBasto from "../assets/cartas/3-basto.png";
import cuatroBasto from "../assets/cartas/4-basto.png";
import cincoBasto from "../assets/cartas/5-basto.png";
import seisBasto from "../assets/cartas/6-basto.png";
import sieteBasto from "../assets/cartas/7-basto.png";
import diezBasto from "../assets/cartas/10-basto.png";
import onceBasto from "../assets/cartas/11-basto.png";
import doceBasto from "../assets/cartas/12-basto.png";

import unoOro from "../assets/cartas/1-oro.png";
import dosOro from "../assets/cartas/2-oro.png";
import tresOro from "../assets/cartas/3-oro.png";
import cuatroOro from "../assets/cartas/4-oro.png";
import cincoOro from "../assets/cartas/5-oro.png";
import seisOro from "../assets/cartas/6-oro.png";
import sieteOro from "../assets/cartas/7-oro.png";
import diezOro from "../assets/cartas/10-oro.png";
import onceOro from "../assets/cartas/11-oro.png";
import doceOro from "../assets/cartas/12-oro.png";

import unoCopa from "../assets/cartas/1-copa.png";
import dosCopa from "../assets/cartas/2-copa.png";
import tresCopa from "../assets/cartas/3-copa.png";
import cuatroCopa from "../assets/cartas/4-copa.png";
import cincoCopa from "../assets/cartas/5-copa.png";
import seisCopa from "../assets/cartas/6-copa.png";
import sieteCopa from "../assets/cartas/7-copa.png";
import diezCopa from "../assets/cartas/10-copa.png";
import onceCopa from "../assets/cartas/11-copa.png";
import doceCopa from "../assets/cartas/12-copa.png";

export const cartasImg = {
  "1-espada": unoEspada,
  "2-espada": dosEspada,
  "3-espada": tresEspada,
  "4-espada": cuatroEspada,
  "5-espada": cincoEspada,
  "6-espada": seisEspada,
  "7-espada": sieteEspada,
  "10-espada": diezEspada,
  "11-espada": onceEspada,
  "12-espada": doceEspada,

  "1-basto": unoBasto,
  "2-basto": dosBasto,
  "3-basto": tresBasto,
  "4-basto": cuatroBasto,
  "5-basto": cincoBasto,
  "6-basto": seisBasto,
  "7-basto": sieteBasto,
  "10-basto": diezBasto,
  "11-basto": onceBasto,
  "12-basto": doceBasto,

  "1-oro": unoOro,
  "2-oro": dosOro,
  "3-oro": tresOro,
  "4-oro": cuatroOro,
  "5-oro": cincoOro,
  "6-oro": seisOro,
  "7-oro": sieteOro,
  "10-oro": diezOro,
  "11-oro": onceOro,
  "12-oro": doceOro,

  "1-copa": unoCopa,
  "2-copa": dosCopa,
  "3-copa": tresCopa,
  "4-copa": cuatroCopa,
  "5-copa": cincoCopa,
  "6-copa": seisCopa,
  "7-copa": sieteCopa,
  "10-copa": diezCopa,
  "11-copa": onceCopa,
  "12-copa": doceCopa,
};

export const palos = ["espada", "basto", "oro", "copa"];
export const numeros = [1, 2, 3, 4, 5, 6, 7, 10, 11, 12];

export function getCartaImg(carta) {
  return cartasImg[carta];
}

export function generarMazo() {
  return palos.flatMap((palo) =>
    numeros.map((numero) => {
      const id = `${numero}-${palo}`;

      return {
        numero,
        palo,
        id,
        nombre: `${numero} de ${palo}`,
        img: getCartaImg(id),
      };
    }),
  );
}
