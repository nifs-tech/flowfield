varying vec3 vColor;

void main()
{
    float distanceToCenter = length(gl_PointCoord - 0.5);
    if(distanceToCenter > 0.5)
        discard;
    
    gl_FragColor = vec4(1.0, 0.0, 0.0, 1.0);    gl_FragColor = vec4(1, 0.5, 1, 0.5);  
    gl_FragColor = vec4(0.5, 1, 0.5, 1);  
    
    #include <tonemapping_fragment>
    #include <colorspace_fragment>

}
