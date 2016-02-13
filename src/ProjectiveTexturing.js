		/**
		* 
		* @author AD IGN
		* Class generating shaders for projective texturing of MULTIPLE IMAGES in a single shader. This class can be used 
		* to texture any mesh. We need to set the matrix of Orientation of the projector
		* and its projective camera information.
		*/

		define (['GraphicEngine','lib/three','Ori','Shader', 'PanoramicProvider','url'],
			function (graphicEngine, THREE, Ori, Shader, PanoramicProvider,url) {

				window.requestAnimSelectionAlpha = (function(){
                         return  window.requestAnimationFrame || 
                         window.webkitRequestAnimationFrame   || 
                         window.mozRequestAnimationFrame      || 
                         window.oRequestAnimationFrame        || 
                         window.msRequestAnimationFrame       || 
                         function(callback, element){
                             window.setTimeout(callback, 1000 / 60);
                         };
               })();

				var _shaderMat = null;
				var _initiated = false;
				var _targetNbPanoramics;
				var _withMask = true;

				var ProjectiveTexturing = {
					
					init: function(targetNbPanoramics){
						_targetNbPanoramics = targetNbPanoramics || 2;
						_initiated = true;
					},
					
					isInitiated: function(){
						return _initiated;
					},	
					
					// display all the images of the panoramics
					nbImages: function(){
						return Ori.sensors.length;
					},
					
					nbMasks: function(){
						if(!_withMask) return 0;
						var count = 0;
						for (var i=0; i<this.nbImages(); ++i)
							if(Ori.getMask(i)) ++count;
						return count;
					},
					
					// throttle down the number of panoramics to meet the gl.MAX_* constraints
					nbPanoramics: function(){ 
						var N = this.nbImages();
						var gl = graphicEngine.getRenderer().getContext();
						var M = this.nbMasks();
						var maxVaryingVec = gl.getParameter(gl.MAX_VARYING_VECTORS);
						var maxTextureImageUnits = gl.getParameter(gl.MAX_TEXTURE_IMAGE_UNITS);
						var maxNbPanoramics = Math.floor(Math.min(maxVaryingVec,(maxTextureImageUnits-M))/N);
						var P = Math.min(_targetNbPanoramics,maxNbPanoramics);
						console.log("Masks : ", M);
						console.log("Images per panoramic  : ", N ,"/",N);
						console.log("Panoramics displayed : ", P ,"/",_targetNbPanoramics);
						console.log("Varying usage : ", (N*P) ,"/",maxVaryingVec);
						console.log("Texture units usage : ", (M+N*P) ,"/",maxTextureImageUnits);
						return P;
					},
					
					loadTexture: function(src,onload,data){
	          var img = new Image(); 
	          img.crossOrigin = 'anonymous';
	          img.onload = function () { 	
	          	var tex = new THREE.Texture(this,THREE.UVMapping, 
	          		THREE.RepeatWrapping, THREE.RepeatWrapping, THREE.LinearFilter,THREE.LinearFilter,THREE.RGBFormat);
							tex.needsUpdate = true;
							tex.flipY = false;
							onload(tex,data);
						}
						var baseUrl = PanoramicProvider.getMetaDataSensorURL();
						img.src = url.resolve(baseUrl,src);
					},

					createShaderMat: function(panoInfo,rot){  
						var N = this.nbImages();
						var P = this.nbPanoramics();
						var uniforms = {
							distortion  : {type:'v4v',value:[]},
							pps         : {type:'v2v',value:[]},
							size        : {type:'v2v',value:[]},
							alpha       : {type:'fv1',value:[]},
							mvpp        : {type:'m3v',value:[]},
							translation : {type:'v3v',value:[]},
							texture     : {type:'tv' ,value:[]},
							mask        : {type:'tv' ,value:[]}
						};
						var idmask = [];
						for (var i=0; i<N; ++i){
							var mat = Ori.getMatrix(i).clone();
							var mvpp = (new THREE.Matrix3().multiplyMatrices(rot,mat)).transpose();
							var trans = Ori.getSommet(i).clone().applyMatrix3(rot);
							var m = -1;
							if(_withMask && Ori.getMask(i)) {
								m = uniforms.mask.value.length;
								uniforms.mask.value[m] = null;
							}
							for(var pano=0; pano<P; ++pano) {
								var j = i+N*pano;
								uniforms.distortion.value[j] = Ori.getDistortion(i);
								uniforms.pps.value[j] = Ori.getPPS(i);
								uniforms.size.value[j] = Ori.getSize(i);
								uniforms.alpha.value[j] = 1-pano;
								uniforms.mvpp.value[j]=mvpp;
								uniforms.translation.value[j]=trans;
								uniforms.texture.value[j] = null;
								idmask[j]=m;
							}
						}
						console.log(uniforms.mask.value);
          	// create the shader material for Three
          	_shaderMat = new THREE.ShaderMaterial({
          		uniforms:     	uniforms,
          		vertexShader:   Shader.shaderTextureProjectiveVS(P*N),
          		fragmentShader: Shader.shaderTextureProjectiveFS(P*N,idmask),
          		side: THREE.BackSide,   
          		transparent:true
          	});

						for (var i=0; i<N; ++i) {
							var m= idmask[i];
							if(m>=0) {
								this.loadTexture(Ori.getMask(i), function(tex,m) { 	
									_shaderMat.uniforms.mask.value[m] = tex; 
								}, m);
							}
							var panoUrl = panoInfo.url_format.replace("{cam_id_pos}",Ori.sensors[i].infos.cam_id_pos);
  						this.loadTexture(panoUrl, function(tex,i) { 	
								_shaderMat.uniforms.texture.value[i] = tex;
							}, i);
						}
            return _shaderMat;
          },
					tweenIndiceTime: function (i){
            			var alpha = _shaderMat.uniforms.alpha.value[i];
            			if(alpha<1){
	            			var j = i + this.nbImages();
                			alpha += 0.03;
                			if(alpha>1) alpha=1;
                			_shaderMat.uniforms.alpha.value[i] = alpha;
                			_shaderMat.uniforms.alpha.value[j] = 1-alpha;
                			var that = this;
                			requestAnimSelectionAlpha(function() { that.tweenIndiceTime(i); });                			
           	 			}	
					},
            		changePanoTextureAfterloading: function (panoInfo,translation,rotation){
            			for (var i=0; i< Ori.sensors.length; ++i){            			
            				this.chargeOneImageCam(panoInfo,translation,rotation,i);
            			}
            		},
	         		// Load an Image(html) then use it as a texture. Wait loading before passing to the shader to avoid black effect
	         		chargeOneImageCam: function (panoInfo,translation,rotation,i){
								var panoUrl = panoInfo.url_format.replace("{cam_id_pos}",Ori.sensors[i].infos.cam_id_pos);
								var that = this;
								this.loadTexture(panoUrl, function(tex) { 	
										var mat = Ori.getMatrix(i).clone();
										var mvpp = (new THREE.Matrix3().multiplyMatrices( rotation,mat )).transpose();
	            			var trans = Ori.getSommet(i).clone().applyMatrix3(rotation);
	            			var j = i + that.nbImages();
	            			if(j<_shaderMat.uniforms.mvpp.value.length) {
											_shaderMat.uniforms.mvpp.value[j] = _shaderMat.uniforms.mvpp.value[i];
											_shaderMat.uniforms.translation.value[j] = _shaderMat.uniforms.translation.value[i];
											_shaderMat.uniforms.texture.value[j] =_shaderMat.uniforms.texture.value[i];
											_shaderMat.uniforms.alpha.value[j] = 1;
											_shaderMat.uniforms.alpha.value[i] = 0;
											that.tweenIndiceTime(i);
										}

	            			_shaderMat.uniforms.mvpp.value[i] = mvpp;
	            			_shaderMat.uniforms.translation.value[i] = translation.clone().add(trans);
	            			_shaderMat.uniforms.texture.value[i] = tex;
	            			_shaderMat.uniforms.texture.value[i].needsUpdate = true;
									});
								} 
	            }
	            return ProjectiveTexturing
	        	}
	        )
