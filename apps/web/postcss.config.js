import postcssGlobalData from '@csstools/postcss-global-data';
import postcssCustomMedia from 'postcss-custom-media';

/**
 * @custom-media kirilimlari (roadmap P6). CSS degiskeni @media icinde CALISMAZ
 * (tarayici media query'yi degiskenler cozulmeden degerlendirir); bu yuzden
 * kirilimlar @custom-media ile tanimlanir ve derlemede duz @media'ya acilir.
 *
 * Her CSS modulu AYRI islendigi icin tanimlar baska dosyada gorunmez;
 * global-data eklentisi breakpoints.css'i her dosyaya yalnizca referans olarak
 * verir (ciktiya yazmaz). Boylece kirilimlar tek dosyada durur.
 */
export default {
  plugins: [
    postcssGlobalData({ files: ['src/shared/styles/breakpoints.css'] }),
    postcssCustomMedia(),
  ],
};
